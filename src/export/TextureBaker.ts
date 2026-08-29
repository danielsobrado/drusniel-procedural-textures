import * as THREE from 'three';
import { EXPORT_CONFIG } from '../app/constants';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import { createFrameBudget } from '../utils/scheduling';
import {
  disposeBakeSnapshot,
  flipRowsInPlace,
  snapshotBakeMesh,
  type BakeMeshSnapshot
} from './BakeGeometry';

export type BakeChannel =
  | 'albedo'
  | 'roughness'
  | 'normal'
  | 'height'
  | 'clearcoat'
  | 'clearcoat-roughness'
  | 'metallic'
  | 'ao'
  | 'emissive';

/** The PBR channels, in the order they are rendered. */
export type PbrChannelName = Exclude<BakeChannel, 'height'>;

export type { BakeMeshSnapshot } from './BakeGeometry';

const PBR_CHANNELS: readonly PbrChannelName[] = [
  'albedo',
  'roughness',
  'normal',
  'clearcoat',
  'clearcoat-roughness',
  'metallic',
  'ao',
  'emissive'
];
const FULL_BAKE_CHANNELS: readonly BakeChannel[] = [...PBR_CHANNELS, 'height'];

/**
 * Reports which channel is about to be rendered. `index` is zero-based and `total`
 * counts every channel in this bake, so the caller can render an honest fraction.
 */
export type BakeProgressCallback = (channel: BakeChannel, index: number, total: number) => void;

/** Ceiling on the non-blocking link poll before falling back to a compile that must return. */
const SHADER_COMPILE_POLL_BUDGET_MS = 10_000;

/**
 * A baked channel is held as its canvas. PNG encoding is deferred to the download path: the
 * seamless tile export rewrites every canvas after the bake, so encoding here produced a blob
 * that was always discarded and re-encoded, doubling the slowest step of a full-resolution
 * export. See pngBlobsForTextureSet.
 */
export interface BakedTexture {
  canvas: HTMLCanvasElement;
}

export interface BakedPbrTextureSet {
  resolution: number;
  albedo: BakedTexture;
  roughness: BakedTexture;
  normal: BakedTexture;
  clearcoat: BakedTexture;
  clearcoatRoughness: BakedTexture;
  metallic: BakedTexture;
  ao: BakedTexture;
  emissive: BakedTexture;
}

export interface BakedTextureSet extends BakedPbrTextureSet {
  height: BakedTexture;
}

interface BakeContext {
  scene: THREE.Scene;
  mesh: THREE.Mesh;
  target: THREE.WebGLRenderTarget;
}

const CHANNEL_MODE: Record<BakeChannel, number> = {
  albedo: 0,
  roughness: 1,
  normal: 2,
  height: 3,
  clearcoat: 4,
  'clearcoat-roughness': 5,
  metallic: 6,
  ao: 7,
  emissive: 8
};
const DILATION_PENDING_ALPHA = 1;

function isDisplacementChannel(channel: BakeChannel): boolean {
  return channel === 'normal' || channel === 'height';
}

function applyBakePhysicalSettings(
  material: THREE.ShaderMaterial,
  settings: Readonly<PhysicalSettings>
): void {
  const uniforms = material.uniforms;
  if (uniforms.uBakeBaseRoughness !== undefined) uniforms.uBakeBaseRoughness.value = settings.roughness;
  if (uniforms.uBakeBaseMetalness !== undefined) uniforms.uBakeBaseMetalness.value = settings.metalness;
  if (uniforms.uBakeBaseClearcoat !== undefined) uniforms.uBakeBaseClearcoat.value = settings.clearcoat;
  if (uniforms.uBakeBaseClearcoatRoughness !== undefined) {
    uniforms.uBakeBaseClearcoatRoughness.value = settings.clearcoatRoughness;
  }
}

function copyPixel(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  sourceIndex: number,
  targetIndex: number,
  alpha: number
): void {
  const sourceOffset = sourceIndex * 4;
  const targetOffset = targetIndex * 4;
  pixels[targetOffset] = pixels[sourceOffset] ?? 0;
  pixels[targetOffset + 1] = pixels[sourceOffset + 1] ?? 0;
  pixels[targetOffset + 2] = pixels[sourceOffset + 2] ?? 0;
  pixels[targetOffset + 3] = alpha;
}

function enqueueDilatedNeighbor(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  queue: Int32Array<ArrayBuffer>,
  queueTail: number,
  sourceIndex: number,
  neighborIndex: number
): number {
  if (neighborIndex < 0 || (pixels[neighborIndex * 4 + 3] ?? 0) !== 0) return queueTail;
  copyPixel(pixels, sourceIndex, neighborIndex, DILATION_PENDING_ALPHA);
  queue[queueTail] = neighborIndex;
  return queueTail + 1;
}

async function dilateTransparentPixels(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  iterations: number
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  if (iterations <= 0) return pixels;

  const pixelCount = width * height;
  const budget = createFrameBudget();
  let queue: Int32Array<ArrayBuffer> | null = null;
  let queueHead = 0;
  let queueTail = 0;

  for (let y = 0; y < height; y += 1) {
    if (budget.isDue()) await budget.yieldIfDue();
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((pixels[index * 4 + 3] ?? 0) !== 0) continue;

      let sourceIndex = -1;
      if (x > 0 && (pixels[(index - 1) * 4 + 3] ?? 0) > DILATION_PENDING_ALPHA) sourceIndex = index - 1;
      else if (x + 1 < width && (pixels[(index + 1) * 4 + 3] ?? 0) > DILATION_PENDING_ALPHA) sourceIndex = index + 1;
      else if (y > 0 && (pixels[(index - width) * 4 + 3] ?? 0) > DILATION_PENDING_ALPHA) sourceIndex = index - width;
      else if (y + 1 < height && (pixels[(index + width) * 4 + 3] ?? 0) > DILATION_PENDING_ALPHA) sourceIndex = index + width;

      if (sourceIndex >= 0) {
        queue ??= new Int32Array(new ArrayBuffer(pixelCount * Int32Array.BYTES_PER_ELEMENT));
        copyPixel(pixels, sourceIndex, index, DILATION_PENDING_ALPHA);
        queue[queueTail] = index;
        queueTail += 1;
      }
    }
  }

  if (queue === null) return pixels;

  let depth = 1;
  while (queueHead < queueTail && depth < iterations) {
    const levelEnd = queueTail;
    while (queueHead < levelEnd) {
      const index = queue[queueHead] ?? -1;
      queueHead += 1;
      if (index < 0) continue;

      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) queueTail = enqueueDilatedNeighbor(pixels, queue, queueTail, index, index - 1);
      if (x + 1 < width) queueTail = enqueueDilatedNeighbor(pixels, queue, queueTail, index, index + 1);
      if (y > 0) queueTail = enqueueDilatedNeighbor(pixels, queue, queueTail, index, index - width);
      if (y + 1 < height) queueTail = enqueueDilatedNeighbor(pixels, queue, queueTail, index, index + width);

      if (budget.isDue()) await budget.yieldIfDue();
    }
    depth += 1;
  }

  for (let index = 0; index < queueTail; index += 1) {
    const pixelIndex = queue[index] ?? -1;
    if (pixelIndex >= 0) pixels[pixelIndex * 4 + 3] = 255;
    if (budget.isDue()) await budget.yieldIfDue();
  }
  return pixels;
}

function requireRenderedTexture(
  rendered: ReadonlyMap<BakeChannel, BakedTexture>,
  channel: BakeChannel
): BakedTexture {
  const texture = rendered.get(channel);
  if (texture === undefined) throw new Error(`Bake did not produce the ${channel} channel.`);
  return texture;
}

function pbrTextureSet(
  resolution: number,
  rendered: ReadonlyMap<BakeChannel, BakedTexture>
): BakedPbrTextureSet {
  return {
    resolution,
    albedo: requireRenderedTexture(rendered, 'albedo'),
    roughness: requireRenderedTexture(rendered, 'roughness'),
    normal: requireRenderedTexture(rendered, 'normal'),
    clearcoat: requireRenderedTexture(rendered, 'clearcoat'),
    clearcoatRoughness: requireRenderedTexture(rendered, 'clearcoat-roughness'),
    metallic: requireRenderedTexture(rendered, 'metallic'),
    ao: requireRenderedTexture(rendered, 'ao'),
    emissive: requireRenderedTexture(rendered, 'emissive')
  };
}

export class TextureBaker {
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  public constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly compiler: MaterialCompiler
  ) {}

  public async prepare(): Promise<void> {
    await this.compiler.ensureBakeReady(this.renderer);
  }

  public snapshotMesh(source: THREE.Mesh): BakeMeshSnapshot {
    return snapshotBakeMesh(source);
  }

  public disposeSnapshot(snapshot: BakeMeshSnapshot): void {
    disposeBakeSnapshot(snapshot);
  }

  public async bake(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    onProgress?: BakeProgressCallback
  ): Promise<BakedTextureSet> {
    await this.prepare();
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      return await this.bakeSnapshot(snapshot, settings, resolution, material, onProgress);
    } finally {
      material.dispose();
      this.disposeSnapshot(snapshot);
    }
  }

  public async bakePbr(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number
  ): Promise<BakedPbrTextureSet> {
    await this.prepare();
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      return await this.bakePbrSnapshot(snapshot, settings, resolution, material);
    } finally {
      material.dispose();
      this.disposeSnapshot(snapshot);
    }
  }

  public async bakeAlbedo(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number
  ): Promise<BakedTexture> {
    await this.prepare();
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      const rendered = await this.renderChannelsSnapshot(
        snapshot,
        settings,
        resolution,
        material,
        ['albedo']
      );
      return requireRenderedTexture(rendered, 'albedo');
    } finally {
      material.dispose();
      this.disposeSnapshot(snapshot);
    }
  }

  public async bakeSnapshot(
    snapshot: BakeMeshSnapshot,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    material: THREE.ShaderMaterial,
    onProgress?: BakeProgressCallback
  ): Promise<BakedTextureSet> {
    const rendered = await this.renderChannelsSnapshot(
      snapshot,
      settings,
      resolution,
      material,
      FULL_BAKE_CHANNELS,
      onProgress
    );
    return {
      ...pbrTextureSet(resolution, rendered),
      height: requireRenderedTexture(rendered, 'height')
    };
  }

  public async bakePbrSnapshot(
    snapshot: BakeMeshSnapshot,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    material: THREE.ShaderMaterial
  ): Promise<BakedPbrTextureSet> {
    const rendered = await this.renderChannelsSnapshot(
      snapshot,
      settings,
      resolution,
      material,
      PBR_CHANNELS
    );
    return pbrTextureSet(resolution, rendered);
  }

  private async renderChannelsSnapshot(
    snapshot: BakeMeshSnapshot,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    material: THREE.ShaderMaterial,
    channels: readonly BakeChannel[],
    onProgress?: BakeProgressCallback
  ): Promise<ReadonlyMap<BakeChannel, BakedTexture>> {
    if (!Number.isInteger(resolution) || resolution < 128 || resolution > 4096) {
      throw new Error('Bake resolution must be an integer between 128 and 4096 pixels.');
    }

    await this.prepare();
    this.compiler.applyBakeTextureFields(material);

    const hasSurfacePass = channels.some((channel) => !isDisplacementChannel(channel));
    const hasDisplacementPass = channels.some(isDisplacementChannel);
    const displacementMaterial = hasDisplacementPass
      ? this.compiler.createBakeMaterial(settings, 'displacement')
      : null;
    const context = this.createContext(snapshot, material, resolution);
    applyBakePhysicalSettings(material, settings);

    try {
      if (hasSurfacePass) {
        context.mesh.material = material;
        await this.prepareContext(context, snapshot.name);
      }
      if (displacementMaterial !== null) {
        context.mesh.material = displacementMaterial;
        await this.prepareContext(context, snapshot.name);
      }

      const rendered = new Map<BakeChannel, BakedTexture>();
      for (const [index, channel] of channels.entries()) {
        onProgress?.(channel, index, channels.length);
        const channelMaterial = isDisplacementChannel(channel) ? displacementMaterial : material;
        if (channelMaterial === null) {
          throw new Error(`Texture bake material is unavailable for the ${channel} channel.`);
        }
        context.mesh.material = channelMaterial;
        rendered.set(channel, await this.renderChannel(context, channelMaterial, channel, resolution));
      }
      return rendered;
    } finally {
      this.disposeContext(context);
      displacementMaterial?.dispose();
    }
  }

  private createContext(
    snapshot: BakeMeshSnapshot,
    material: THREE.ShaderMaterial,
    resolution: number
  ): BakeContext {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(snapshot.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(snapshot.matrixWorld);
    mesh.matrixWorld.copy(snapshot.matrixWorld);
    scene.add(mesh);

    const target = new THREE.WebGLRenderTarget(resolution, resolution, { depthBuffer: false, stencilBuffer: false });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    return { scene, mesh, target };
  }

  /**
   * Linking the portable bake program is the longest single step for a many-layer material, and
   * the synchronous renderer.compile() blocks the main thread for all of it, freezing the
   * caller's progress reporting. compileAsync lets the driver link off-thread where
   * KHR_parallel_shader_compile is available, matching LabRenderer and PresetThumbnailRenderer.
   *
   * three.js polls COMPLETION_STATUS_KHR with no deadline, so a driver that never reports ready
   * would hang the bake outright. The poll is therefore bounded: past the budget we fall back to
   * the synchronous compile, which always returns. See tests/nonblocking-ui.test.ts.
   */
  private async compileWithinBudget(context: BakeContext): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'timeout'>((resolve) => {
      timer = globalThis.setTimeout(() => resolve('timeout'), SHADER_COMPILE_POLL_BUDGET_MS);
    });
    // A late rejection from the abandoned link would otherwise surface as an unhandled
    // rejection once the timeout has already won the race.
    const compiled = this.renderer
      .compileAsync(context.scene, this.camera)
      .then(() => 'compiled' as const);
    compiled.catch(() => undefined);
    try {
      if ((await Promise.race([compiled, expired])) === 'timeout') {
        this.renderer.compile(context.scene, this.camera);
      }
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  }

  private async prepareContext(context: BakeContext, meshName: string): Promise<void> {
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) throw new Error('Texture bake WebGL context is lost.');

    const previousCheckShaderErrors = this.renderer.debug.checkShaderErrors;
    const previousShaderError = this.renderer.debug.onShaderError;
    let shaderError: Error | null = null;

    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (webGl, program, vertexShader, fragmentShader) => {
      const logs = [
        webGl.getProgramInfoLog(program)?.trim(),
        webGl.getShaderInfoLog(vertexShader)?.trim(),
        webGl.getShaderInfoLog(fragmentShader)?.trim()
      ].filter((value): value is string => value !== undefined && value.length > 0);
      shaderError = new Error(
        logs.length > 0 ? logs.join('\n') : 'Shader validation failed without a driver diagnostic.'
      );
    };

    try {
      await this.compileWithinBudget(context);
      if (shaderError !== null) {
        const materialName = Array.isArray(context.mesh.material)
          ? 'Texture bake material'
          : context.mesh.material.name || context.mesh.material.type;
        throw new Error(
          `Texture bake shader compilation failed for mesh "${meshName}" using ${materialName}.`,
          { cause: shaderError }
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Texture bake shader compilation failed')) {
        throw error;
      }
      throw new Error(`Texture bake shader compilation failed for mesh "${meshName}".`, { cause: error });
    } finally {
      this.renderer.debug.checkShaderErrors = previousCheckShaderErrors;
      this.renderer.debug.onShaderError = previousShaderError;
    }
  }

  private disposeContext(context: BakeContext): void {
    context.scene.remove(context.mesh);
    context.target.dispose();
  }

  private async renderChannel(
    context: BakeContext,
    material: THREE.ShaderMaterial,
    channel: BakeChannel,
    resolution: number
  ): Promise<BakedTexture> {
    if (this.renderer.getContext().isContextLost()) {
      throw new Error(`Texture bake WebGL context was lost before rendering the ${channel} channel.`);
    }

    const modeUniform = material.uniforms.uBakeMode;
    if (modeUniform === undefined) throw new Error('Bake shader is missing its output mode uniform.');
    modeUniform.value = CHANNEL_MODE[channel];

    const previousTarget = this.renderer.getRenderTarget();
    const previousClearColor = this.renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = this.renderer.getClearAlpha();
    const pixels = new Uint8Array(new ArrayBuffer(resolution * resolution * 4));

    try {
      this.renderer.setRenderTarget(context.target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
      this.renderer.render(context.scene, this.camera);
      await this.renderer.readRenderTargetPixelsAsync(
        context.target,
        0,
        0,
        resolution,
        resolution,
        pixels
      );
    } catch (error) {
      if (this.renderer.getContext().isContextLost()) {
        throw new Error(`Texture bake WebGL context was lost while rendering the ${channel} channel.`, {
          cause: error
        });
      }
      throw error;
    } finally {
      if (!this.renderer.getContext().isContextLost()) {
        this.renderer.setRenderTarget(previousTarget);
        this.renderer.setClearColor(previousClearColor, previousClearAlpha);
      }
    }

    if (this.renderer.getContext().isContextLost()) {
      throw new Error(`Texture bake WebGL context was lost while rendering the ${channel} channel.`);
    }

    const flipped = flipRowsInPlace(pixels, resolution, resolution);
    const padded = await dilateTransparentPixels(
      flipped,
      resolution,
      resolution,
      EXPORT_CONFIG.texturePaddingPx
    );
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    // A canvas keeps the attributes of whichever getContext call created its context, so the
    // willReadFrequently requested later by makeTextureSeamless, the terrain preset library and
    // the GLB height sampler is ignored unless it is set here. Without it every downstream
    // getImageData is a GPU readback of the full bake resolution.
    const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
    if (canvasContext === null) throw new Error('Browser does not provide a 2D canvas required for texture baking.');
    canvasContext.putImageData(new ImageData(padded, resolution, resolution), 0, 0);
    return { canvas };
  }
}
