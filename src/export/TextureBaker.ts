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

export interface BakedTextureSet {
  resolution: number;
  albedo: BakedTexture;
  roughness: BakedTexture;
  normal: BakedTexture;
  height: BakedTexture;
  clearcoat: BakedTexture;
  clearcoatRoughness: BakedTexture;
}

const CHANNEL_MODE: Record<BakeChannel, number> = {
  albedo: 0,
  roughness: 1,
  normal: 2,
  height: 3,
  clearcoat: 4,
  'clearcoat-roughness': 5
};

function needsDeformedGeometry(mesh: THREE.Mesh): boolean {
  return mesh instanceof THREE.SkinnedMesh ||
    (mesh.morphTargetInfluences?.some((value) => Math.abs(value) > 1e-8) ?? false);
}

function createBakeGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  if (mesh instanceof THREE.InstancedMesh) {
    throw new Error('Instanced meshes must be converted to regular meshes before texture baking.');
  }

  const uv = mesh.geometry.getAttribute('uv');
  const position = mesh.geometry.getAttribute('position');
  if (uv === undefined || uv.count === 0) {
    throw new Error(`Mesh "${mesh.name || 'Unnamed mesh'}" has no UV coordinates to bake into.`);
  }
  if (position === undefined || position.count === 0 || uv.count !== position.count) {
    throw new Error(`Mesh "${mesh.name || 'Unnamed mesh'}" has invalid UV or position attributes.`);
  }

  const geometry = mesh.geometry.clone();
  if (!needsDeformedGeometry(mesh)) {
    if (geometry.getAttribute('normal') === undefined) {
      geometry.computeVertexNormals();
    }
    return geometry;
  }

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
  geometry.computeVertexNormals();
  return geometry;
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
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1]
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

export class TextureBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  public constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly compiler: MaterialCompiler
  ) {}

  public async bake(
    source: THREE.Mesh,
    settings: Readonly<PhysicalSettings>,
    resolution: number
  ): Promise<BakedTextureSet> {
    if (!Number.isInteger(resolution) || resolution < 128 || resolution > 4096) {
      throw new Error('Bake resolution must be an integer between 128 and 4096 pixels.');
    }

    source.updateMatrixWorld(true);
    const geometry = createBakeGeometry(source);
    const material = this.compiler.createBakeMaterial(settings);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(source.matrixWorld);
    this.scene.add(mesh);

    const target = new THREE.WebGLRenderTarget(resolution, resolution, {
      depthBuffer: false,
      stencilBuffer: false
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;

    try {
      const albedo = await this.renderChannel(target, material, 'albedo', resolution);
      const roughness = await this.renderChannel(target, material, 'roughness', resolution);
      const normal = await this.renderChannel(target, material, 'normal', resolution);
      const height = await this.renderChannel(target, material, 'height', resolution);
      const clearcoat = await this.renderChannel(target, material, 'clearcoat', resolution);
      const clearcoatRoughness = await this.renderChannel(
        target,
        material,
        'clearcoat-roughness',
        resolution
      );
      return {
        resolution,
        albedo,
        roughness,
        normal,
        height,
        clearcoat,
        clearcoatRoughness
      };
    } finally {
      this.scene.remove(mesh);
      target.dispose();
      material.dispose();
      geometry.dispose();
    }
  }

  private async renderChannel(
    target: THREE.WebGLRenderTarget,
    material: THREE.ShaderMaterial,
    channel: BakeChannel,
    resolution: number
  ): Promise<BakedTexture> {
    const modeUniform = material.uniforms.uBakeMode;
    if (modeUniform === undefined) {
      throw new Error('Bake shader is missing its output mode uniform.');
    }
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
