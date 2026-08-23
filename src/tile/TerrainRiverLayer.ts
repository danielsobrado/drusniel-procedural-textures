import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { TerrainFields } from './TerrainTypes';

function fieldIndex(x: number, y: number, size: number): number {
  const wrappedX = ((x % size) + size) % size;
  const wrappedY = ((y % size) + size) % size;
  return wrappedY * size + wrappedX;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

function validateAlphaDataInput(river: Float32Array, resolution: number, widthPixels: number): void {
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new Error('River alpha resolution must be a positive integer.');
  }
  if (river.length !== resolution * resolution) {
    throw new Error('River field dimensions do not match the requested resolution.');
  }
  if (!Number.isInteger(widthPixels) || widthPixels < 1 || widthPixels > resolution) {
    throw new Error('River width must be an integer between 1 and the terrain resolution.');
  }
}

export function buildRiverAlphaData(
  river: Float32Array,
  resolution: number,
  widthPixels: number
): Uint8Array {
  validateAlphaDataInput(river, resolution, widthPixels);

  const radius = widthPixels - 1;
  const data = new Uint8Array(resolution * resolution * 4);
  const alphaStart = TERRAIN_CONFIG.preview.riverAlphaStart;
  const alphaEnd = TERRAIN_CONFIG.preview.riverAlphaEnd;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      let maximum = 0;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          maximum = Math.max(
            maximum,
            river[fieldIndex(x + offsetX, y + offsetY, resolution)] ?? 0
          );
        }
      }
      const alpha = Math.round(smoothstep(alphaStart, alphaEnd, maximum) * 255);
      const output = (y * resolution + x) * 4;
      data[output] = alpha;
      data[output + 1] = alpha;
      data[output + 2] = alpha;
      data[output + 3] = 255;
    }
  }
  return data;
}

export class TerrainRiverLayer {
  private readonly material = new THREE.MeshStandardMaterial({
    color: TERRAIN_CONFIG.preview.riverColor,
    roughness: TERRAIN_CONFIG.preview.riverRoughness,
    metalness: 0,
    transparent: true,
    opacity: TERRAIN_CONFIG.preview.riverOpacity,
    alphaTest: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  private readonly meshes: THREE.Mesh[] = [];
  private texture: THREE.DataTexture | null = null;
  private lastRiver: Float32Array | null = null;
  private lastResolution = 0;
  private disposed = false;

  public constructor(
    private readonly scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    tileRadius: number,
    tileSize: number
  ) {
    const yOffset = TERRAIN_CONFIG.preview.riverOffsetMeters * tileSize / TERRAIN_CONFIG.worldSize;
    for (let tileZ = -tileRadius; tileZ <= tileRadius; tileZ += 1) {
      for (let tileX = -tileRadius; tileX <= tileRadius; tileX += 1) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.position.set(tileX * tileSize, yOffset, tileZ * tileSize);
        mesh.visible = tileX === 0 && tileZ === 0;
        mesh.renderOrder = 2;
        this.meshes.push(mesh);
        this.scene.add(mesh);
      }
    }
  }

  public update(fields: Readonly<TerrainFields>): void {
    if (this.disposed) throw new Error('Terrain river layer has been disposed.');
    if (this.lastRiver === fields.river && this.lastResolution === fields.resolution) return;

    const data = buildRiverAlphaData(
      fields.river,
      fields.resolution,
      TERRAIN_CONFIG.preview.riverWidthPixels
    );
    const texture = new THREE.DataTexture(
      data,
      fields.resolution,
      fields.resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    texture.needsUpdate = true;

    const previousTexture = this.texture;
    this.texture = texture;
    this.material.alphaMap = texture;
    this.material.needsUpdate = true;
    this.lastRiver = fields.river;
    this.lastResolution = fields.resolution;
    previousTexture?.dispose();
  }

  public setRepeatedVisible(visible: boolean): void {
    for (const mesh of this.meshes) {
      mesh.visible = visible || (mesh.position.x === 0 && mesh.position.z === 0);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) this.scene.remove(mesh);
    this.meshes.length = 0;
    this.material.alphaMap = null;
    this.texture?.dispose();
    this.texture = null;
    this.lastRiver = null;
    this.lastResolution = 0;
    this.material.dispose();
  }
}
