import * as THREE from 'three';
import { EXPORT_CONFIG } from '../app/constants';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';

export type BakeChannel =
  | 'albedo'
  | 'roughness'
  | 'normal'
  | 'height'
  | 'clearcoat'
  | 'clearcoat-roughness';

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
}

export interface BakedTextureSet extends BakedPbrTextureSet {
  height: BakedTexture;
}

export interface BakeMeshSnapshot {
  readonly geometry: THREE.BufferGeometry;
  readonly matrixWorld: THREE.Matrix4;
  readonly name: string;
  readonly generatedUvAtlas: boolean;
}

const CHANNEL_MODE: Record<BakeChannel, number> = {
  albedo: 0,
  roughness: 1,
  normal: 2,
  height: 3,
  clearcoat: 4,
  'clearcoat-roughness': 5
};

const UV_EPSILON = 1e-5;
const UV_OVERLAP_GRID_SIZE = 256;
const TRIANGLE_ATLAS_PADDING = 0.14;

function needsDeformedGeometry(mesh: THREE.Mesh): boolean {
  return mesh instanceof THREE.SkinnedMesh ||
    (mesh.morphTargetInfluences?.some((value) => Math.abs(value) > 1e-8) ?? false);
}

function triangleVertexIndex(
  geometry: THREE.BufferGeometry,
  triangle: number,
  corner: number
): number {
  const index = geometry.getIndex();
  return index === null ? triangle * 3 + corner : index.getX(triangle * 3 + corner);
}

function shareEdge(
  geometry: THREE.BufferGeometry,
  firstTriangle: number,
  secondTriangle: number
): boolean {
  let shared = 0;
  for (let firstCorner = 0; firstCorner < 3; firstCorner += 1) {
    const first = triangleVertexIndex(geometry, firstTriangle, firstCorner);
    for (let secondCorner = 0; secondCorner < 3; secondCorner += 1) {
      if (first === triangleVertexIndex(geometry, secondTriangle, secondCorner)) {
        shared += 1;
        break;
      }
    }
  }
  return shared >= 2;
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < -UV_EPSILON || d2 < -UV_EPSILON || d3 < -UV_EPSILON;
  const hasPositive = d1 > UV_EPSILON || d2 > UV_EPSILON || d3 > UV_EPSILON;
  return !(hasNegative && hasPositive);
}

function validateBakeUv(geometry: THREE.BufferGeometry, meshName: string): void {
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  if (uv === undefined || uv.count === 0) {
    throw new Error(`Mesh "${meshName}" has no UV coordinates to bake into.`);
  }
  if (position === undefined || position.count === 0 || uv.count !== position.count || uv.itemSize < 2) {
    throw new Error(`Mesh "${meshName}" has invalid UV or position attributes.`);
  }

  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      throw new Error(`Mesh "${meshName}" contains non-finite UV coordinates.`);
    }
    if (u < -UV_EPSILON || u > 1 + UV_EPSILON || v < -UV_EPSILON || v > 1 + UV_EPSILON) {
      throw new Error(
        `Mesh "${meshName}" uses tiled or out-of-range UVs. Texture baking requires a unique 0–1 unwrap.`
      );
    }
  }

  const index = geometry.getIndex();
  const indexCount = index?.count ?? position.count;
  const triangleCount = Math.floor(indexCount / 3);
  const occupancy = new Int32Array(UV_OVERLAP_GRID_SIZE * UV_OVERLAP_GRID_SIZE);
  occupancy.fill(-1);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = triangleVertexIndex(geometry, triangle, 0);
    const ib = triangleVertexIndex(geometry, triangle, 1);
    const ic = triangleVertexIndex(geometry, triangle, 2);
    const ax = uv.getX(ia);
    const ay = uv.getY(ia);
    const bx = uv.getX(ib);
    const by = uv.getY(ib);
    const cx = uv.getX(ic);
    const cy = uv.getY(ic);
    const doubledArea = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (doubledArea <= 1e-10) continue;

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * UV_OVERLAP_GRID_SIZE));
    const maxX = Math.min(
      UV_OVERLAP_GRID_SIZE - 1,
      Math.floor(Math.max(ax, bx, cx) * UV_OVERLAP_GRID_SIZE)
    );
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * UV_OVERLAP_GRID_SIZE));
    const maxY = Math.min(
      UV_OVERLAP_GRID_SIZE - 1,
      Math.floor(Math.max(ay, by, cy) * UV_OVERLAP_GRID_SIZE)
    );

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = (x + 0.5) / UV_OVERLAP_GRID_SIZE;
        const py = (y + 0.5) / UV_OVERLAP_GRID_SIZE;
        if (!pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) continue;

        const cell = y * UV_OVERLAP_GRID_SIZE + x;
        const previous = occupancy[cell];
        if (previous >= 0 && previous !== triangle && !shareEdge(geometry, previous, triangle)) {
          throw new Error(
            `Mesh "${meshName}" contains overlapping or mirrored UV islands. Texture baking requires a unique unwrap.`
          );
        }
        occupancy[cell] = triangle;
      }
    }
  }
}

function createTriangleAtlas(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const atlas = source.getIndex() === null ? source.clone() : source.toNonIndexed();
  const position = atlas.getAttribute('position');
  if (position === undefined || position.count < 3) {
    atlas.dispose();
    throw new Error('Cannot create a bake UV atlas for geometry without triangles.');
  }

  const triangleCount = Math.floor(position.count / 3);
  const grid = Math.ceil(Math.sqrt(triangleCount));
  const cell = 1 / grid;
  const padding = TRIANGLE_ATLAS_PADDING * cell;
  const uvs = new Float32Array(position.count * 2);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const x = triangle % grid;
    const y = Math.floor(triangle / grid);
    const left = x * cell + padding;
    const right = (x + 1) * cell - padding;
    const bottom = y * cell + padding;
    const top = (y + 1) * cell - padding;
    const offset = triangle * 6;
    uvs[offset] = left;
    uvs[offset + 1] = bottom;
    uvs[offset + 2] = right;
    uvs[offset + 3] = bottom;
    uvs[offset + 4] = left;
    uvs[offset + 5] = top;
  }

  atlas.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return atlas;
}

function createBakeGeometry(mesh: THREE.Mesh): { geometry: THREE.BufferGeometry; generatedUvAtlas: boolean } {
  if (mesh instanceof THREE.InstancedMesh) {
    throw new Error('Instanced meshes must be converted to regular meshes before texture baking.');
  }

  const position = mesh.geometry.getAttribute('position');
  if (position === undefined || position.count === 0) {
    throw new Error(`Mesh "${mesh.name || 'Unnamed mesh'}" has no positions to bake.`);
  }

  let geometry = mesh.geometry.clone();
  if (needsDeformedGeometry(mesh)) {
    const vertex = new THREE.Vector3();
    const positions = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
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

  try {
    validateBakeUv(geometry, mesh.name || 'Unnamed mesh');
    return { geometry, generatedUvAtlas: false };
  } catch (error) {
    if (mesh.userData.labProceduralPreview !== true) {
      geometry.dispose();
      throw error;
    }
    const atlas = createTriangleAtlas(geometry);
    geometry.dispose();
    validateBakeUv(atlas, mesh.name || 'Procedural mesh');
    return { geometry: atlas, generatedUvAtlas: true };
  }
}

function flipRows(source: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const rowBytes = width * 4;
  const flipped = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = (height - y - 1) * rowBytes;
    flipped.set(source.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
  }
  return flipped;
}

function dilateTransparentPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  iterations: number
): Uint8ClampedArray {
  let current = pixels;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8ClampedArray(current);
    let changed = false;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if ((current[offset + 3] ?? 0) !== 0) continue;
        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
        ] as const;
        for (const [neighborX, neighborY] of neighbors) {
          if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
          const neighborOffset = (neighborY * width + neighborX) * 4;
          if ((current[neighborOffset + 3] ?? 0) === 0) continue;
          next[offset] = current[neighborOffset] ?? 0;
          next[offset + 1] = current[neighborOffset + 1] ?? 0;
          next[offset + 2] = current[neighborOffset + 2] ?? 0;
          next[offset + 3] = 255;
          changed = true;
          break;
        }
      }
    }
    current = next;
    if (!changed) break;
  }
  return current;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('Browser failed to encode the baked PNG texture.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

interface BakeContext {
  mesh: THREE.Mesh;
  target: THREE.WebGLRenderTarget;
}

export class TextureBaker {
  private readonly scene = new THREE.Scene();
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
      generatedUvAtlas: bake.generatedUvAtlas
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
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      const common = await this.renderPbrSnapshot(snapshot, settings, resolution, material);
      const context = this.createContext(snapshot, material, resolution);
      try {
        const height = await this.renderChannel(context.target, material, 'height', resolution);
        return { ...common, height };
      } finally {
        this.disposeContext(context);
      }
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
    const snapshot = this.snapshotMesh(source);
    const material = this.compiler.createBakeMaterial(settings);
    try {
      return await this.renderPbrSnapshot(snapshot, settings, resolution, material);
    } finally {
      material.dispose();
      this.disposeSnapshot(snapshot);
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
    if (uniforms.uBakeBaseClearcoat !== undefined) uniforms.uBakeBaseClearcoat.value = settings.clearcoat;
    if (uniforms.uBakeBaseClearcoatRoughness !== undefined) {
      uniforms.uBakeBaseClearcoatRoughness.value = settings.clearcoatRoughness;
    }

    try {
      const albedo = await this.renderChannel(context.target, material, 'albedo', resolution);
      const roughness = await this.renderChannel(context.target, material, 'roughness', resolution);
      const normal = await this.renderChannel(context.target, material, 'normal', resolution);
      const clearcoat = await this.renderChannel(context.target, material, 'clearcoat', resolution);
      const clearcoatRoughness = await this.renderChannel(
        context.target,
        material,
        'clearcoat-roughness',
        resolution
      );
      return { resolution, albedo, roughness, normal, clearcoat, clearcoatRoughness };
    } finally {
      this.disposeContext(context);
    }
  }

  private createContext(
    snapshot: BakeMeshSnapshot,
    material: THREE.ShaderMaterial,
    resolution: number
  ): BakeContext {
    const mesh = new THREE.Mesh(snapshot.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(snapshot.matrixWorld);
    mesh.matrixWorld.copy(snapshot.matrixWorld);
    this.scene.add(mesh);

    const target = new THREE.WebGLRenderTarget(resolution, resolution, {
      depthBuffer: false,
      stencilBuffer: false
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    return { mesh, target };
  }

  private disposeContext(context: BakeContext): void {
    this.scene.remove(context.mesh);
    context.target.dispose();
  }

  private async renderChannel(
    target: THREE.WebGLRenderTarget,
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
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(previousClearColor, previousClearAlpha);
    }

    const flipped = flipRows(pixels, resolution, resolution);
    const padded = dilateTransparentPixels(
      flipped,
      resolution,
      resolution,
      EXPORT_CONFIG.texturePaddingPx
    );
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('Browser does not provide a 2D canvas required for texture baking.');
    }
    context.putImageData(new ImageData(padded, resolution, resolution), 0, 0);
    return { canvas, blob: await canvasToPng(canvas) };
  }
}
