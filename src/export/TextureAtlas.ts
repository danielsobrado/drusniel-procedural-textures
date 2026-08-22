import * as THREE from 'three';
import type { BakedPbrTextureSet, BakedTexture, BakedTextureSet } from './TextureBaker';

export interface SharedAtlasLayout {
  readonly grid: number;
  readonly tileSize: number;
  readonly resolution: number;
}

export interface SharedAtlasTextureSet extends BakedPbrTextureSet {
  readonly grid: number;
  readonly tileSize: number;
}

const HEIGHT_NEUTRAL = 0.5;
const ATLAS_TEXEL_INSET = 0.5;

function floorPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 0;
  return 2 ** Math.floor(Math.log2(value));
}

export function createSharedAtlasLayout(
  count: number,
  requestedTileSize: number,
  maxTextureSize: number,
  minTileSize: number
): SharedAtlasLayout {
  if (!Number.isInteger(count) || count < 1) throw new Error('Shared atlas requires at least one material target.');
  const minimumGrid = Math.ceil(Math.sqrt(count));
  const grid = 2 ** Math.ceil(Math.log2(minimumGrid));
  const maximumTile = floorPowerOfTwo(maxTextureSize / grid);
  const tileSize = Math.min(requestedTileSize, maximumTile);
  if (tileSize < minTileSize) {
    throw new Error(
      `The ${count}-mesh shared atlas would reduce each material tile below ${minTileSize} px. ` +
      'Use a higher export quality tier or assign the lab material to fewer meshes.'
    );
  }
  return { grid, tileSize, resolution: grid * tileSize };
}

function createCanvas(resolution: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  return canvas;
}

function atlasTexture(
  sets: readonly BakedPbrTextureSet[],
  layout: SharedAtlasLayout,
  pick: (set: BakedPbrTextureSet) => BakedTexture
): BakedTexture {
  const canvas = createCanvas(layout.resolution);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Browser does not provide a 2D canvas required for atlas export.');

  for (let index = 0; index < sets.length; index += 1) {
    const col = index % layout.grid;
    const uvRow = Math.floor(index / layout.grid);
    const canvasRow = layout.grid - uvRow - 1;
    context.drawImage(
      pick(sets[index] as BakedPbrTextureSet).canvas,
      col * layout.tileSize,
      canvasRow * layout.tileSize,
      layout.tileSize,
      layout.tileSize
    );
  }

  return { canvas, blob: new Blob() };
}

export function combinePbrTextureSets(
  sets: readonly BakedPbrTextureSet[],
  layout: SharedAtlasLayout
): SharedAtlasTextureSet {
  if (sets.length === 0) throw new Error('Cannot combine an empty baked material set.');
  return {
    grid: layout.grid,
    tileSize: layout.tileSize,
    resolution: layout.resolution,
    albedo: atlasTexture(sets, layout, (set) => set.albedo),
    roughness: atlasTexture(sets, layout, (set) => set.roughness),
    normal: atlasTexture(sets, layout, (set) => set.normal),
    clearcoat: atlasTexture(sets, layout, (set) => set.clearcoat),
    clearcoatRoughness: atlasTexture(sets, layout, (set) => set.clearcoatRoughness)
  };
}

export function remapGeometryUvToAtlas(
  source: THREE.BufferGeometry,
  slot: number,
  layout: Readonly<SharedAtlasLayout>
): THREE.BufferGeometry {
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= layout.grid * layout.grid ||
    !Number.isInteger(layout.grid) ||
    layout.grid < 1 ||
    !Number.isInteger(layout.resolution) ||
    layout.resolution < 1
  ) {
    throw new Error('Invalid shared-atlas slot or layout.');
  }
  const geometry = source.clone();
  const uv = geometry.getAttribute('uv');
  if (uv === undefined || uv.itemSize < 2) {
    geometry.dispose();
    throw new Error('Cannot remap shared-atlas UVs on geometry without UV coordinates.');
  }

  const col = slot % layout.grid;
  const row = Math.floor(slot / layout.grid);
  const inset = ATLAS_TEXEL_INSET / layout.resolution;
  const slotSize = 1 / layout.grid;
  const minU = col * slotSize + inset;
  const maxU = (col + 1) * slotSize - inset;
  const minV = row * slotSize + inset;
  const maxV = (row + 1) * slotSize - inset;

  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(
      index,
      THREE.MathUtils.lerp(minU, maxU, uv.getX(index)),
      THREE.MathUtils.lerp(minV, maxV, uv.getY(index))
    );
  }
  uv.needsUpdate = true;
  return geometry;
}

function heightPixels(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Browser cannot read the baked height map for displaced GLB export.');
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function sampleHeight(image: ImageData, u: number, v: number, extent: number): number {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(u * (image.width - 1))));
  const y = Math.max(0, Math.min(image.height - 1, Math.round((1 - v) * (image.height - 1))));
  const red = image.data[(y * image.width + x) * 4] ?? 128;
  const normalized = red / 255;
  return (normalized - HEIGHT_NEUTRAL) * extent * 2;
}

export function applyStaticDisplacement(
  source: THREE.BufferGeometry,
  height: BakedTextureSet['height'],
  matrixWorld: THREE.Matrix4,
  displacementExtent: number
): THREE.BufferGeometry {
  if (displacementExtent <= 1e-8) return source.clone();
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (position === undefined || normal === undefined || uv === undefined || uv.itemSize < 2) {
    geometry.dispose();
    throw new Error('Static displacement export requires position, normal and UV attributes.');
  }

  const image = heightPixels(height.canvas);
  const worldLinear = new THREE.Matrix3().setFromMatrix4(matrixWorld);
  const inverseWorldLinear = worldLinear.clone().invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const determinant = worldLinear.determinant();
  if (Math.abs(determinant) < 1e-10) {
    geometry.dispose();
    throw new Error('Cannot bake displacement into geometry with a singular world transform.');
  }

  const localNormal = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const localOffset = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    const authoredHeight = sampleHeight(image, uv.getX(index), uv.getY(index), displacementExtent);
    if (Math.abs(authoredHeight) <= 1e-8) continue;
    localNormal.fromBufferAttribute(normal, index);
    worldNormal.copy(localNormal).applyMatrix3(normalMatrix).normalize();
    if (determinant < 0) worldNormal.negate();
    localOffset.copy(worldNormal).multiplyScalar(authoredHeight).applyMatrix3(inverseWorldLinear);
    position.setXYZ(
      index,
      position.getX(index) + localOffset.x,
      position.getY(index) + localOffset.y,
      position.getZ(index) + localOffset.z
    );
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
