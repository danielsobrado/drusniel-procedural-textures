import * as THREE from 'three';
import type { PhysicalSettings } from '../materials/types';
import { EXPORT_CONFIG } from '../app/constants';

export interface BakedTextureSet {
  albedo: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  height: THREE.CanvasTexture;
  clearcoat: THREE.CanvasTexture;
  clearcoatRoughness: THREE.CanvasTexture;
}

export interface BakeOptions {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  physical: Readonly<PhysicalSettings>;
  size: number;
  displacementExtent: number;
}

const BAKE_MODES = Object.freeze({
  albedo: 0,
  roughness: 1,
  normal: 2,
  height: 3,
  clearcoat: 4,
  clearcoatRoughness: 5
});

const UV_EPSILON = 1e-5;
const OVERLAP_GRID_SIZE = 128;

function validateBakeUv(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (position === undefined || uv === undefined || uv.itemSize < 2 || uv.count !== position.count) {
    throw new Error('Texture baking requires a valid UV set matching the mesh vertices.');
  }

  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index);
    const v = uv.getY(index);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      throw new Error('Texture baking requires finite UV coordinates.');
    }
    if (u < -UV_EPSILON || u > 1 + UV_EPSILON || v < -UV_EPSILON || v > 1 + UV_EPSILON) {
      throw new Error('Texture baking currently requires UVs inside the 0–1 range. Tiled UVs must be unwrapped first.');
    }
  }

  const indexAttribute = geometry.getIndex();
  const triangleCount = indexAttribute === null ? Math.floor(position.count / 3) : Math.floor(indexAttribute.count / 3);
  const occupancy = new Int32Array(OVERLAP_GRID_SIZE * OVERLAP_GRID_SIZE);
  occupancy.fill(-1);

  const vertexIndex = (triangle: number, corner: number): number =>
    indexAttribute === null ? triangle * 3 + corner : indexAttribute.getX(triangle * 3 + corner);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = vertexIndex(triangle, 0);
    const ib = vertexIndex(triangle, 1);
    const ic = vertexIndex(triangle, 2);
    const ax = uv.getX(ia); const ay = uv.getY(ia);
    const bx = uv.getX(ib); const by = uv.getY(ib);
    const cx = uv.getX(ic); const cy = uv.getY(ic);

    const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (area <= 1e-10) continue;

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * (OVERLAP_GRID_SIZE - 1)));
    const maxX = Math.min(OVERLAP_GRID_SIZE - 1, Math.ceil(Math.max(ax, bx, cx) * (OVERLAP_GRID_SIZE - 1)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * (OVERLAP_GRID_SIZE - 1)));
    const maxY = Math.min(OVERLAP_GRID_SIZE - 1, Math.ceil(Math.max(ay, by, cy) * (OVERLAP_GRID_SIZE - 1)));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = (x + 0.5) / OVERLAP_GRID_SIZE;
        const py = (y + 0.5) / OVERLAP_GRID_SIZE;
        const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
        const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
        const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
        const inside = (d1 <= 0 && d2 <= 0 && d3 <= 0) || (d1 >= 0 && d2 >= 0 && d3 >= 0);
        if (!inside) continue;

        const cell = y * OVERLAP_GRID_SIZE + x;
        const previous = occupancy[cell];
        if (previous >= 0 && previous !== triangle) {
          throw new Error('Texture baking requires non-overlapping UV islands. Overlapping or mirrored UVs must be uniquely unwrapped first.');
        }
        occupancy[cell] = triangle;
      }
    }
  }
}

function canvasTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function renderTargetToCanvas(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  size: number
): HTMLCanvasElement {
  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  const flipped = new Uint8ClampedArray(pixels.length);
  const rowBytes = size * 4;
  for (let y = 0; y < size; y += 1) {
    const sourceOffset = (size - y - 1) * rowBytes;
    flipped.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Browser does not provide a 2D canvas for baked textures.');
  context.putImageData(new ImageData(flipped, size, size), 0, 0);
  return canvas;
}

function dilateCanvas(source: HTMLCanvasElement, iterations: number): HTMLCanvasElement {
  if (iterations <= 0) return source;
  const width = source.width;
  const height = source.height;
  const context = source.getContext('2d', { willReadFrequently: true });
  if (context === null) return source;
  let image = context.getImageData(0, 0, width, height);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Uint8ClampedArray(image.data);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const offset = (y * width + x) * 4;
        if (image.data[offset + 3] !== 0) continue;
        let filled = false;
        for (let dy = -1; dy <= 1 && !filled; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const neighbor = ((y + dy) * width + x + dx) * 4;
            if (image.data[neighbor + 3] === 0) continue;
            next[offset] = image.data[neighbor];
            next[offset + 1] = image.data[neighbor + 1];
            next[offset + 2] = image.data[neighbor + 2];
            next[offset + 3] = 255;
            filled = true;
            break;
          }
        }
      }
    }
    image = new ImageData(next, width, height);
  }

  context.putImageData(image, 0, 0);
  return source;
}

export class TextureBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly target = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false
  });

  public constructor(private readonly renderer: THREE.WebGLRenderer) {}

  public async bake(options: BakeOptions): Promise<BakedTextureSet> {
    validateBakeUv(options.mesh.geometry);
    const size = Math.max(64, Math.floor(options.size));
    this.target.setSize(size, size);

    const bakeGeometry = options.mesh.geometry.clone();
    bakeGeometry.applyMatrix4(options.mesh.matrixWorld);
    const bakeMesh = new THREE.Mesh(bakeGeometry, options.material);
    bakeMesh.frustumCulled = false;
    this.scene.add(bakeMesh);

    const previousTarget = this.renderer.getRenderTarget();
    const previousClearColor = this.renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = this.renderer.getClearAlpha();
    const uniforms = options.material.uniforms as Record<string, THREE.IUniform>;
    if (uniforms.uBakeBaseRoughness !== undefined) uniforms.uBakeBaseRoughness.value = options.physical.roughness;
    if (uniforms.uBakeBaseClearcoat !== undefined) uniforms.uBakeBaseClearcoat.value = options.physical.clearcoat;
    if (uniforms.uBakeBaseClearcoatRoughness !== undefined) uniforms.uBakeBaseClearcoatRoughness.value = options.physical.clearcoatRoughness;
    if (uniforms.uBakeHeightExtent !== undefined) uniforms.uBakeHeightExtent.value = Math.max(options.displacementExtent, 1e-6);

    const renderMode = (mode: number, colorSpace: THREE.ColorSpace): THREE.CanvasTexture => {
      const modeUniform = uniforms.uBakeMode;
      if (modeUniform === undefined) throw new Error('Bake material does not expose uBakeMode.');
      modeUniform.value = mode;
      this.renderer.setRenderTarget(this.target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      const canvas = dilateCanvas(renderTargetToCanvas(this.renderer, this.target, size), EXPORT_CONFIG.dilationPixels);
      return canvasTexture(canvas, colorSpace);
    };

    try {
      const albedo = renderMode(BAKE_MODES.albedo, THREE.SRGBColorSpace);
      const roughness = renderMode(BAKE_MODES.roughness, THREE.NoColorSpace);
      const normal = renderMode(BAKE_MODES.normal, THREE.NoColorSpace);
      const height = renderMode(BAKE_MODES.height, THREE.NoColorSpace);
      const clearcoat = renderMode(BAKE_MODES.clearcoat, THREE.NoColorSpace);
      const clearcoatRoughness = renderMode(BAKE_MODES.clearcoatRoughness, THREE.NoColorSpace);
      await Promise.resolve();
      return { albedo, roughness, normal, height, clearcoat, clearcoatRoughness };
    } finally {
      this.scene.remove(bakeMesh);
      bakeGeometry.dispose();
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(previousClearColor, previousClearAlpha);
    }
  }

  public dispose(): void {
    this.target.dispose();
  }
}
