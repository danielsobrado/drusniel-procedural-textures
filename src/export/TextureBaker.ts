import * as THREE from 'three';
import { EXPORT_CONFIG } from '../app/constants';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import { canvasToPngBlob } from '../utils/canvas';
import { createTriangleAtlas, validateBakeUv } from './UvValidation';

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

export interface BakedTexture {
  canvas: HTMLCanvasElement;
  blob: Blob;
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

export interface BakeMeshSnapshot {
  readonly geometry: THREE.BufferGeometry;
  readonly matrixWorld: THREE.Matrix4;
  readonly name: string;
  readonly generatedUvAtlas: boolean;
  readonly dynamicGeometry: boolean;
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
const PIXEL_WORK_YIELD_INTERVAL = 262_144;

function hasMorphTargets(mesh: THREE.Mesh): boolean {
  return Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0);
}

function isDynamicGeometry(mesh: THREE.Mesh): boolean {
  return mesh instanceof THREE.SkinnedMesh || hasMorphTargets(mesh);
}

function needsDeformedGeometry(mesh: THREE.Mesh): boolean {
  return mesh instanceof THREE.SkinnedMesh ||
    (mesh.morphTargetInfluences?.some((value) => Math.abs(value) > 1e-8) ?? false);
}

function createBakeGeometry(
  mesh: THREE.Mesh
): { geometry: THREE.BufferGeometry; generatedUvAtlas: boolean; dynamicGeometry: boolean } {
  if (mesh instanceof THREE.InstancedMesh) {
    throw new Error('Instanced meshes must be converted to regular meshes before texture baking.');
  }

  const sourcePosition = mesh.geometry.getAttribute('position');
  if (sourcePosition === undefined || sourcePosition.count === 0) {
    throw new Error(`Mesh "${mesh.name || 'Unnamed mesh'}" has no positions to bake.`);
  }

  const dynamicGeometry = isDynamicGeometry(mesh);
  let geometry = mesh.geometry.clone();
  if (needsDeformedGeometry(mesh)) {
    const vertex = new THREE.Vector3();
    const positions = new Float32Array(sourcePosition.count * 3);
    for (let index = 0; index < sourcePosition.count; index += 1) {
      mesh.getVertexPosition(index, vertex);
      const offset = index * 3;
      positions[offset] = vertex.x;
      positions[offset + 1] = vertex.y;
      positions[offset + 2] = vertex.z;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.deleteAttribute('normal');
  }
  if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals();

  const meshName = mesh.name || 'Unnamed mesh';
  try {
    validateBakeUv(geometry, meshName);
    return { geometry, generatedUvAtlas: false, dynamicGeometry };
  } catch (error) {
    const canAutoPack = mesh.userData.labProceduralPreview === true ||
      (EXPORT_CONFIG.automaticUvPacking && !dynamicGeometry);
    if (!canAutoPack) {
      geometry.dispose();
      if (dynamicGeometry && EXPORT_CONFIG.automaticUvPacking) {
        throw new Error(
          `Mesh "${meshName}" needs a unique 0–1 UV unwrap. Automatic packing is intentionally disabled for ` +
          'skinned or morph-target meshes because changing their vertex topology can invalidate animation data.',
          { cause: error }
        );
      }
      throw error;
    }
    const atlas = createTriangleAtlas(geometry);
    geometry.dispose();
    validateBakeUv(atlas, meshName);
    return { geometry: atlas, generatedUvAtlas: true, dynamicGeometry };
  }
}

function flipRowsInPlace(
  source: Uint8Array<ArrayBuffer>,
  width: number,
  height: number
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4;
  const pixels = new Uint8ClampedArray(source.buffer, source.byteOffset, source.byteLength);
  const row = new Uint8ClampedArray(rowBytes);
  const halfHeight = Math.floor(height / 2);
  for (let y = 0; y < halfHeight; y += 1) {
    const topOffset = y * rowBytes;
    const bottomOffset = (height - y - 1) * rowBytes;
    row.set(pixels.subarray(topOffset, topOffset + rowBytes));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
    pixels.set(row, bottomOffset);
  }
  return pixels;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  let queue: Int32Array<ArrayBuffer> | null = null;
  let queueHead = 0;
  let queueTail = 0;
  let scanned = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      scanned += 1;
      if (scanned % PIXEL_WORK_YIELD_INTERVAL === 0) await yieldToMainThread();
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

      if (queueHead % PIXEL_WORK_YIELD_INTERVAL === 0) await yieldToMainThread();
    }
    depth += 1;
  }

  for (let index = 0; index < queueTail; index += 1) {
    const pixelIndex = queue[index] ?? -1;
    if (pixelIndex >= 0) pixels[pixelIndex * 4 + 3] = 255;
    if (index > 0 && index % PIXEL_WORK_YIELD_INTERVAL === 0) await yieldToMainThread();
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

  public snapshotMesh(source: THREE.Mesh): BakeMeshSnapshot {
    source.updateMatrixWorld(true);
    const bake = createBakeGeometry(source);
    return {
      geometry: bake.geometry,
      matrixWorld: source.matrixWorld.clone(),
      name: source.name || 'Unnamed mesh',
      generatedUvAtlas: bake.generatedUvAtlas,
      dynamicGeometry: bake.dynamicGeometry
    };
  }

  public disposeSnapshot(snapshot: BakeMeshSnapshot): void {
    snapshot.geometry.dispose();
  }

  public async bake(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    onProgress?: BakeProgressCallback
  ): Promise<BakedTextureSet> {
    await this.compiler.ensureSimulationReady();
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
    await this.compiler.ensureSimulationReady();
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      return await this.bakePbrSnapshot(snapshot, settings, resolution, material);
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

    const context = this.createContext(snapshot, material, resolution);
    const uniforms = material.uniforms;
    if (uniforms.uBakeBaseRoughness !== undefined) uniforms.uBakeBaseRoughness.value = settings.roughness;
    if (uniforms.uBakeBaseMetalness !== undefined) uniforms.uBakeBaseMetalness.value = settings.metalness;
    if (uniforms.uBakeBaseClearcoat !== undefined) uniforms.uBakeBaseClearcoat.value = settings.clearcoat;
    if (uniforms.uBakeBaseClearcoatRoughness !== undefined) {
      uniforms.uBakeBaseClearcoatRoughness.value = settings.clearcoatRoughness;
    }

    try {
      this.prepareContext(context, snapshot.name);
      const rendered = new Map<BakeChannel, BakedTexture>();
      for (const [index, channel] of channels.entries()) {
        onProgress?.(channel, index, channels.length);
        rendered.set(channel, await this.renderChannel(context, material, channel, resolution));
      }
      return rendered;
    } finally {
      this.disposeContext(context);
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

  private prepareContext(context: BakeContext, meshName: string): void {
    try {
      this.renderer.compile(context.scene, this.camera);
    } catch (error) {
      throw new Error(`Texture bake shader compilation failed for mesh "${meshName}".`, { cause: error });
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
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(previousClearColor, previousClearAlpha);
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
    const canvasContext = canvas.getContext('2d');
    if (canvasContext === null) throw new Error('Browser does not provide a 2D canvas required for texture baking.');
    canvasContext.putImageData(new ImageData(padded, resolution, resolution), 0, 0);
    return { canvas, blob: await canvasToPngBlob(canvas) };
  }
}
