import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  abs,
  clamp,
  cross,
  dot,
  float,
  length,
  max,
  mix,
  mrt,
  modelWorldMatrix,
  normalLocal,
  normalWorldGeometry,
  normalize,
  positionLocal,
  select,
  uv,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import type { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import type { WebGpuSurfaceNodes } from '../materials/WebGpuSurfaceDesignerNodes';
import {
  disposeBakeSnapshot,
  flipRowsInPlace,
  snapshotBakeMesh,
  type BakeMeshSnapshot
} from './BakeGeometry';
import type {
  BakeChannel,
  BakedTexture,
  BakedTextureSet,
  PbrChannelName
} from './TextureBaker';

/**
 * The eight surface channels one multi-render-target pass writes. Height is excluded because it
 * comes from the displacement graph and WebGPU guarantees only eight colour attachments, so it
 * takes a second single-attachment pass. Two passes replace the WebGL2 baker's nine.
 */
const SURFACE_ATTACHMENTS: readonly PbrChannelName[] = [
  'albedo',
  'roughness',
  'normal',
  'clearcoat',
  'clearcoat-roughness',
  'metallic',
  'ao',
  'emissive'
];

/** MRT keys match render-target texture names; 'output' is three's name for attachment zero. */
const ATTACHMENT_NAMES: Record<PbrChannelName, string> = {
  albedo: 'output',
  roughness: 'ptlRoughness',
  normal: 'ptlNormal',
  clearcoat: 'ptlClearcoat',
  'clearcoat-roughness': 'ptlClearcoatRoughness',
  metallic: 'ptlMetallic',
  ao: 'ptlAo',
  emissive: 'ptlEmissive'
};

const MIN_ROUGHNESS = 0.045;
const SSS_ALBEDO_WEIGHT = 0.22;
const SSS_EPSILON = 0.0001;
const TANGENT_EPSILON = 0.000001;
const SRGB_LINEAR_CUTOFF = 0.0031308;

/**
 * Matches labLinearChannelToSrgb. The bake writes non-colour-managed targets and converts
 * explicitly, exactly as the GLSL bake does: leaving this to the renderer's output colour space
 * would also apply the curve to channels that must stay linear.
 */
function linearChannelToSrgb(value: Node<'float'>): Node<'float'> {
  const safe = max(value, float(0));
  return select(
    safe.lessThanEqual(float(SRGB_LINEAR_CUTOFF)),
    safe.mul(12.92),
    safe.pow(float(1).div(float(2.4))).mul(1.055).sub(0.055)
  );
}

function linearToSrgb(color: Node<'vec3'>): Node<'vec3'> {
  return vec3(
    linearChannelToSrgb(color.x),
    linearChannelToSrgb(color.y),
    linearChannelToSrgb(color.z)
  );
}

/**
 * Reproduces labBakeTangentNormal: rebuild the displaced surface normal from screen-space
 * derivatives of the displaced world position, then express it in the tangent frame. The pass
 * rasterises in UV space, so these derivatives are with respect to UV - which is precisely what
 * makes the result a tangent-space normal map rather than a view-space one.
 */
function bakeTangentNormal(
  worldPosition: Node<'vec3'>,
  baseNormal: Node<'vec3'>,
  height: Node<'float'>
): Node<'vec3'> {
  const displaced = worldPosition.add(baseNormal.mul(height));
  const rawNormal = normalize(cross(displaced.dFdx(), displaced.dFdy()));
  const displacedNormal = select(
    dot(rawNormal, baseNormal).lessThan(float(0)),
    rawNormal.negate(),
    rawNormal
  );

  const positionDx = worldPosition.dFdx();
  const projected = positionDx.sub(baseNormal.mul(dot(baseNormal, positionDx)));
  const fallbackAxis = select(
    abs(baseNormal.z).lessThan(float(0.999)),
    vec3(0, 0, 1),
    vec3(0, 1, 0)
  );
  const tangent = normalize(select(
    length(projected).lessThanEqual(float(TANGENT_EPSILON)),
    cross(fallbackAxis, baseNormal),
    projected
  ));

  const rawBitangent = normalize(cross(baseNormal, tangent));
  const bitangent = select(
    dot(rawBitangent, worldPosition.dFdy()).lessThan(float(0)),
    rawBitangent.negate(),
    rawBitangent
  );

  return normalize(vec3(
    dot(displacedNormal, tangent),
    dot(displacedNormal, bitangent),
    dot(displacedNormal, baseNormal)
  ));
}

/** Where one channel's pixels live: which render target, and which attachment within it. */
export interface ChannelSource {
  readonly target: THREE.RenderTarget;
  readonly attachment: number;
}

/** One bake's GPU-resident results. Nothing here has been copied to the CPU. */
export interface WebGpuBakeChannels {
  readonly sources: ReadonlyMap<PbrChannelName, ChannelSource>;
  readonly heightTarget: THREE.RenderTarget;
  readonly resolution: number;
  /** How many colour attachments the active backend allowed per pass. */
  readonly attachmentsPerPass: number;
  /** Resolved attachment names, for diagnosing MRT routing. */
  readonly attachmentNames: readonly string[];
  dispose(): void;
}

/**
 * WebGPU guarantees eight colour attachments, but the WebGL2 fallback backend can offer fewer -
 * exceeding it fails pipeline creation outright with "output location must be < MAX_DRAW_BUFFERS"
 * rather than degrading. The channels are therefore split into as many passes as the backend
 * allows, which is still one or two passes against the WebGL2 baker's nine.
 */
function maxAttachmentsFor(renderer: THREE.WebGPURenderer): number {
  const backend = (renderer as unknown as {
    backend?: {
      isWebGPUBackend?: boolean;
      gl?: WebGL2RenderingContext;
      device?: { limits?: { maxColorAttachmentBytesPerSample?: number } };
    };
  }).backend;
  if (backend?.isWebGPUBackend === true) {
    const maxBytes = backend.device?.limits?.maxColorAttachmentBytesPerSample ?? 32;
    const allowed = Math.floor(maxBytes / 8);
    return Math.max(1, Math.min(SURFACE_ATTACHMENTS.length, allowed));
  }

  const gl = backend?.gl;
  if (gl !== undefined && typeof gl.getParameter === 'function') {
    const limit = gl.getParameter(gl.MAX_DRAW_BUFFERS) as number | null;
    if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 1) {
      return Math.max(1, Math.min(SURFACE_ATTACHMENTS.length, limit));
    }
  }
  // WebGL2 guarantees at least four draw buffers, so this is the safe floor.
  return Math.min(SURFACE_ATTACHMENTS.length, 4);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

interface BakeSurfaceGraph {
  surface: WebGpuSurfaceNodes;
  worldPosition: Node<'vec3'>;
  baseNormal: Node<'vec3'>;
}

/**
 * Bakes with the same WebGPU renderer that draws the viewport, reusing the viewport's own node
 * graph. Two consequences matter: there is no second GPU context, and the eight surface channels
 * come from one draw instead of a draw plus a full-resolution readback each.
 *
 * Results stay on the GPU as render-target textures. Reading them back is the caller's decision
 * and belongs only to paths that genuinely need bytes - writing a PNG, a GLB or an atlas.
 */
export class WebGpuTextureBaker {
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private surfaceMrt: ReturnType<typeof mrt> | null = null;

  public constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly compiler: MaterialCompiler
  ) {}

  public snapshotMesh(source: THREE.Mesh): BakeMeshSnapshot {
    return snapshotBakeMesh(source);
  }

  public disposeSnapshot(snapshot: BakeMeshSnapshot): void {
    disposeBakeSnapshot(snapshot);
  }

  public async bakeChannels(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number
  ): Promise<WebGpuBakeChannels> {
    this.validateResolution(resolution);
    await this.compiler.ensureSimulationReady();
    const snapshot = this.snapshotMesh(source);
    try {
      return await this.renderSnapshot(snapshot, settings, resolution);
    } finally {
      this.disposeSnapshot(snapshot);
    }
  }

  /**
   * Reads one channel back as a canvas. This is the deliberate GPU-to-CPU boundary: it belongs to
   * the file-writing paths, never to preview or composition, which take the texture directly.
   */
  public async readChannel(
    channels: WebGpuBakeChannels,
    channel: BakeChannel
  ): Promise<BakedTexture> {
    const resolution = channels.resolution;
    const isHeight = channel === 'height';
    const source = isHeight ? undefined : channels.sources.get(channel);
    if (!isHeight && source === undefined) {
      throw new Error(`Bake produced no ${channel} attachment.`);
    }

    // Unlike the WebGL renderer, this overload returns the data rather than filling a buffer.
    const read = await this.renderer.readRenderTargetPixelsAsync(
      isHeight ? channels.heightTarget : source!.target,
      0,
      0,
      resolution,
      resolution,
      isHeight ? 0 : source!.attachment
    );
    const pixels = new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
    const flipped = flipRowsInPlace(
      pixels as Uint8Array<ArrayBuffer>,
      resolution,
      resolution
    );
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    // willReadFrequently must be requested here: a canvas keeps the attributes of whichever
    // getContext call created its context, and the seam and atlas paths read it back later.
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      throw new Error('Browser does not provide a 2D canvas required for texture baking.');
    }
    context.putImageData(new ImageData(flipped, resolution, resolution), 0, 0);
    return { canvas };
  }

  /**
   * Drop-in equivalent of TextureBaker.bake, producing the same BakedTextureSet so the two
   * backends can be compared channel for channel. Note this reads every channel back, which
   * Stage 3 of the performance plan removes for consumers that only need a GPU texture; even
   * so it renders in two passes where the WebGL2 baker needs nine.
   */
  public async bakeAll(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number
  ): Promise<BakedTextureSet> {
    const channels = await this.bakeChannels(source, settings, resolution);
    try {
      const [
        albedo, roughness, normal, clearcoat, clearcoatRoughness, metallic, ao, emissive, height
      ] = await Promise.all(([
        'albedo', 'roughness', 'normal', 'clearcoat', 'clearcoat-roughness',
        'metallic', 'ao', 'emissive', 'height'
      ] as const).map((channel) => this.readChannel(channels, channel)));

      const required = (texture: BakedTexture | undefined, name: string): BakedTexture => {
        if (texture === undefined) throw new Error(`Bake did not produce the ${name} channel.`);
        return texture;
      };

      return {
        resolution,
        albedo: required(albedo, 'albedo'),
        roughness: required(roughness, 'roughness'),
        normal: required(normal, 'normal'),
        clearcoat: required(clearcoat, 'clearcoat'),
        clearcoatRoughness: required(clearcoatRoughness, 'clearcoat roughness'),
        metallic: required(metallic, 'metallic'),
        ao: required(ao, 'ambient occlusion'),
        emissive: required(emissive, 'emissive'),
        height: required(height, 'height')
      };
    } finally {
      channels.dispose();
    }
  }

  private validateResolution(resolution: number): void {
    if (!Number.isInteger(resolution) || resolution < 128 || resolution > 4096) {
      throw new Error('Bake resolution must be an integer between 128 and 4096 pixels.');
    }
  }

  /**
   * Built once per material and shared by every channel, so all nine outputs describe the same
   * surface evaluation rather than nine independently constructed graphs.
   */
  private buildGraph(): BakeSurfaceGraph {
    const localPosition = positionLocal;
    const worldPosition = varying(
      modelWorldMatrix.mul(vec4(localPosition, 1)).xyz,
      'ptlBakeWorldPosition'
    );
    const objectSpace = this.compiler.sampleCoordinateSpace === 'object';
    const samplePosition = varying(
      objectSpace ? localPosition : worldPosition,
      'ptlBakeSamplePosition'
    );
    const baseNormal = varying(normalWorldGeometry, 'ptlBakeWorldNormal');
    const triplanarNormal = objectSpace
      ? varying(normalLocal, 'ptlBakeTriplanarNormal')
      : baseNormal;

    return {
      surface: this.compiler.buildSurfaceNodes(samplePosition, triplanarNormal),
      worldPosition,
      baseNormal
    };
  }

  /** Rasterises the mesh into its own UV layout, matching BAKE_VERTEX_GLSL. */
  private uvSpaceVertexNode(): Node<'vec4'> {
    return vec4(uv().mul(2).sub(1), 0, 1);
  }

  private createSurfaceMaterial(group: readonly PbrChannelName[]): THREE.NodeMaterial {
    const { surface, worldPosition, baseNormal } = this.buildGraph();
    const physical = this.compiler.physicalUniforms;

    const albedo = linearToSrgb(clamp(
      surface.color.add(select(
        surface.sss.greaterThan(float(SSS_EPSILON)),
        surface.sssColor.mul(surface.sss).mul(SSS_ALBEDO_WEIGHT),
        vec3(0)
      )),
      vec3(0),
      vec3(1)
    ));
    const roughness = clamp(
      physical.baseRoughness.add(surface.roughness),
      float(MIN_ROUGHNESS),
      float(1)
    );
    const clearcoat = max(physical.baseClearcoat, surface.clearcoat);
    const clearcoatRoughness = clamp(
      mix(physical.baseClearcoatRoughness, surface.clearcoatRoughness, surface.clearcoat),
      float(0),
      float(1)
    );
    const metallic = clamp(physical.baseMetalness.add(surface.metallic), float(0), float(1));
    const ao = clamp(surface.ao, float(0), float(1));
    const emissive = linearToSrgb(clamp(surface.emissive, vec3(0), vec3(1)));
    const tangentNormal = bakeTangentNormal(
      worldPosition,
      normalize(baseNormal),
      surface.displacement
    ).mul(0.5).add(0.5);

    const material = new THREE.NodeMaterial();
    material.name = 'Procedural Texture Lab WebGPU Bake';
    material.side = THREE.DoubleSide;
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    const byChannel: Record<PbrChannelName, Node<'vec4'>> = {
      albedo: vec4(albedo, 1),
      roughness: vec4(vec3(roughness), 1),
      normal: vec4(tangentNormal, 1),
      clearcoat: vec4(vec3(clearcoat), 1),
      'clearcoat-roughness': vec4(vec3(clearcoatRoughness), 1),
      metallic: vec4(vec3(metallic), 1),
      ao: vec4(vec3(ao), 1),
      emissive: vec4(emissive, 1)
    };

    material.vertexNode = this.uvSpaceVertexNode();
    // Must be outputNode, not fragmentNode. NodeMaterial wraps its whole MRT branch in
    // `if (this.fragmentNode === null)`, so a fragmentNode silently disables multi-target
    // output and leaves every attachment but the first at its cleared value. outputNode sets
    // the same isCustomOutput flag while keeping the MRT path live.
    const first = group[0];
    if (first === undefined) throw new Error('Bake attachment group cannot be empty.');
    material.outputNode = byChannel[first];

    const outputs: Record<string, Node<'vec4'>> = {};
    group.forEach((channel, index) => {
      // Attachment zero of every target is named 'output', which is three's own name for the
      // first slot; the rest carry the per-channel names the MRT keys match against.
      outputs[index === 0 ? 'output' : ATTACHMENT_NAMES[channel]] = byChannel[channel];
    });
    this.surfaceMrt = mrt(outputs);
    return material;
  }

  private createHeightMaterial(): THREE.NodeMaterial {
    const { surface } = this.buildGraph();
    const extent = float(Math.max(this.compiler.displacementExtent, 0.000001));
    const encoded = clamp(
      float(0.5).add(surface.displacement.div(extent.mul(2))),
      float(0),
      float(1)
    );

    const material = new THREE.NodeMaterial();
    material.name = 'Procedural Texture Lab WebGPU Bake Displacement';
    material.side = THREE.DoubleSide;
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    material.vertexNode = this.uvSpaceVertexNode();
    material.fragmentNode = vec4(vec3(encoded), 1);
    return material;
  }

  private createGroupTarget(resolution: number, group: readonly PbrChannelName[]): THREE.RenderTarget {
    const target = new THREE.RenderTarget(resolution, resolution, {
      count: group.length,
      depthBuffer: false,
      stencilBuffer: false
    });
    group.forEach((channel, index) => {
      const texture = target.textures[index];
      if (texture === undefined) throw new Error('Bake render target is missing an attachment.');
      texture.name = index === 0 ? 'output' : ATTACHMENT_NAMES[channel];
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
    });
    return target;
  }

  private createHeightTarget(resolution: number): THREE.RenderTarget {
    const heightTarget = new THREE.RenderTarget(resolution, resolution, {
      depthBuffer: false,
      stencilBuffer: false
    });
    const heightTexture = heightTarget.textures[0];
    if (heightTexture === undefined) throw new Error('Height render target has no attachment.');
    heightTexture.name = 'output';
    heightTexture.colorSpace = THREE.NoColorSpace;
    heightTexture.generateMipmaps = false;
    return heightTarget;
  }

  private async renderSnapshot(
    snapshot: BakeMeshSnapshot,
    settings: Readonly<PhysicalSettings>,
    resolution: number
  ): Promise<WebGpuBakeChannels> {
    // The channel expressions read the compiler's own base physical uniforms, so applying the
    // requested settings here is what keeps a bake and the preview describing one surface.
    this.compiler.applyPhysical(settings);

    const attachmentsPerPass = maxAttachmentsFor(this.renderer);
    const groups = chunk(SURFACE_ATTACHMENTS, attachmentsPerPass);
    const sources = new Map<PbrChannelName, ChannelSource>();
    const targets: THREE.RenderTarget[] = [];
    const heightTarget = this.createHeightTarget(resolution);

    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(snapshot.geometry);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(snapshot.matrixWorld);
    mesh.matrixWorld.copy(snapshot.matrixWorld);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const previousTarget = this.renderer.getRenderTarget();
    const previousMrt = this.renderer.getMRT();
    const materials: THREE.NodeMaterial[] = [];

    try {
      for (const group of groups) {
        const target = this.createGroupTarget(resolution, group);
        targets.push(target);
        const material = this.createSurfaceMaterial(group);
        materials.push(material);

        mesh.material = material;
        // The MRT node resolves its outputs against the render target that is bound when the
        // graph is built, so the target must be set before compiling.
        this.renderer.setRenderTarget(target);
        this.renderer.setMRT(this.surfaceMrt);
        await this.renderer.compileAsync(scene, this.camera);
        this.renderer.clear();
        await this.renderer.renderAsync(scene, this.camera);

        group.forEach((channel, index) => sources.set(channel, { target, attachment: index }));
      }

      const heightMaterial = this.createHeightMaterial();
      materials.push(heightMaterial);
      mesh.material = heightMaterial;
      this.renderer.setRenderTarget(heightTarget);
      this.renderer.setMRT(null);
      await this.renderer.compileAsync(scene, this.camera);
      this.renderer.clear();
      await this.renderer.renderAsync(scene, this.camera);
    } catch (error) {
      for (const target of targets) target.dispose();
      heightTarget.dispose();
      throw error;
    } finally {
      this.renderer.setMRT(previousMrt);
      this.renderer.setRenderTarget(previousTarget);
      scene.remove(mesh);
      for (const material of materials) material.dispose();
    }

    return {
      sources,
      attachmentNames: targets.flatMap((target, groupIndex) =>
        target.textures.map((texture, index) => `${groupIndex}.${index}:${texture.name}`)),
      heightTarget,
      resolution,
      attachmentsPerPass,
      dispose: () => {
        for (const target of targets) target.dispose();
        heightTarget.dispose();
      }
    };
    }
}
