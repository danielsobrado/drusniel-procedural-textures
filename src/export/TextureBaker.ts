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
const DILATION_UNVISITED = 255;
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

function flipRows(source: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4;
  const flipped = new Uint8ClampedArray(new ArrayBuffer(source.length));
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = (height - y - 1) * rowBytes;
    flipped.set(source.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
  }
  return flipped;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function copyPixel(pixels: Uint8ClampedArray<ArrayBuffer>, sourceIndex: number, targetIndex: number): void {
  const sourceOffset = sourceIndex * 4;
  const targetOffset = targetIndex * 4;
  pixels[targetOffset] = pixels[sourceOffset] ?? 0;
  pixels[targetOffset + 1] = pixels[sourceOffset + 1] ?? 0;
  pixels[targetOffset + 2] = pixels[sourceOffset + 2] ?? 0;
  pixels[targetOffset + 3] = 255;
}

async function dilateTransparentPixels(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  iterations: number
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  if (iterations <= 0) return pixels;

  const pixelCount = width * height;
  const distance = new Uint8Array(pixelCount);
  distance.fill(DILATION_UNVISITED);
  let transparentPixels = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    if ((pixels[index * 4 + 3] ?? 0) === 0) transparentPixels += 1;
    else distance[index] = 0;
    if (index > 0 && index % PIXEL_WORK_YIELD_INTERVAL === 0) await yieldToMainThread();
  }
  if (transparentPixels === 0) return pixels;

  const queue = new Int32Array(pixelCount);
  let queueHead = 0;
  let queueTail = 0;
  let scanned = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] !== DILATION_UNVISITED) continue;

      let sourceIndex = -1;
      if (x > 0 && distance[index - 1] === 0) sourceIndex = index - 1;
      else if (x + 1 < width && distance[index + 1] === 0) sourceIndex = index + 1;
      else if (y > 0 && distance[index - width] === 0) sourceIndex = index - width;
      else if (y + 1 < height && distance[index + width] === 0) sourceIndex = index + width;

      if (sourceIndex >= 0) {
        copyPixel(pixels, sourceIndex, index);
        distance[index] = 1;
        queue[queueTail] = index;
        queueTail += 1;
      }

      scanned += 1;
      if (scanned % PIXEL_WORK_YIELD_INTERVAL === 0) await yieldToMainThread();
    }
  }

  while (queueHead < queueTail) {
    const index = queue[queueHead] ?? -1;
    queueHead += 1;
    if (index < 0) continue;
    const nextDistance = (distance[index] ?? DILATION_UNVISITED) + 1;
    if (nextDistance > iterations) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || distance[neighbor] !== DILATION_UNVISITED) continue;
      copyPixel(pixels, index, neighbor);
      distance[neighbor] = nextDistance;
      queue[queueTail] = neighbor;
      queueTail += 1;
    }

    if (queueHead % PIXEL_WORK_YIELD_INTERVAL === 0) await yieldToMainThread();
  }

  return pixels;
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
    resolution: number
  ): Promise<BakedTextureSet> {
    await this.compiler.ensureSimulationReady();
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      return await this.bakeSnapshot(snapshot, settings, resolution, material);
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
    material: THREE.ShaderMaterial
  ): Promise<BakedTextureSet> {
    const common = await this.renderPbrSnapshot(snapshot, settings, resolution, material);
    const context = this.createContext(snapshot, material, resolution);
    try {
      await this.prepareContext(context, snapshot.name);
      const height = await this.renderChannel(context, material, 'height', resolution);
      return { ...common, height };
    } finally {
      this.disposeContext(context);
    }
  }

  public async bakePbrSnapshot(
    snapshot: BakeMeshSnapshot,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    material: THREE.ShaderMaterial
  ): Promise<BakedPbrTextureSet> {
    return this.renderPbrSnapshot(snapshot, settings, resolution, material);
  }

  private async renderPbrSnapshot(
    snapshot: BakeMeshSnapshot,
    settings: Readonly<PhysicalSettings>,
    resolution: number,
    material: THREE.ShaderMaterial
  ): Promise<BakedPbrTextureSet> {
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
      await this.prepareContext(context, snapshot.name);
      const albedo = await this.renderChannel(context, material, 'albedo', resolution);
      const roughness = await this.renderChannel(context, material, 'roughness', resolution);
      const normal = await this.renderChannel(context, material, 'normal', resolution);
      const clearcoat = await this.renderChannel(context, material, 'clearcoat', resolution);
      const clearcoatRoughness = await this.renderChannel(context, material, 'clearcoat-roughness', resolution);
      const metallic = await this.renderChannel(context, material, 'metallic', resolution);
      const ao = await this.renderChannel(context, material, 'ao', resolution);
      const emissive = await this.renderChannel(context, material, 'emissive', resolution);
      return { resolution, albedo, roughness, normal, clearcoat, clearcoatRoughness, metallic, ao, emissive };
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

  private async prepareContext(context: BakeContext, meshName: string): Promise<void> {
    try {
      await this.renderer.compileAsync(context.scene, this.camera);
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
    const pixels = new Uint8Array(resolution * resolution * 4);

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

    const flipped = flipRows(pixels, resolution, resolution);
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
