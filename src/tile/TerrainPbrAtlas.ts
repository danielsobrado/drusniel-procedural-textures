import type { BakedTextureSet } from '../export/TextureBaker';
import {
  TERRAIN_PBR_CHANNELS,
  type TerrainPbrChannel,
  type TerrainPbrTextureSet,
  type TerrainTextureSource
} from './TerrainTypes';

export const TERRAIN_PBR_ATLAS_COLUMNS = 3;
export const TERRAIN_PBR_ATLAS_ROWS = 3;

function textureSourceFromContext(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): TerrainTextureSource {
  return {
    width,
    height,
    pixels: context.getImageData(0, 0, width, height).data.slice()
  };
}

export function terrainTextureFromCanvas(source: HTMLCanvasElement): TerrainTextureSource | null {
  const copy = document.createElement('canvas');
  copy.width = Math.max(1, source.width);
  copy.height = Math.max(1, source.height);
  const context = copy.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(source, 0, 0, copy.width, copy.height);
  return textureSourceFromContext(context, copy.width, copy.height);
}

export function terrainPbrTexturesFromBaked(
  textures: Readonly<BakedTextureSet>
): TerrainPbrTextureSet | null {
  const result: Partial<Record<TerrainPbrChannel, TerrainTextureSource>> = {};
  for (const channel of TERRAIN_PBR_CHANNELS) {
    const texture = terrainTextureFromCanvas(textures[channel].canvas);
    if (texture === null) return null;
    result[channel] = texture;
  }
  return result as TerrainPbrTextureSet;
}

export function createTerrainPbrAtlas(textures: Readonly<BakedTextureSet>): HTMLCanvasElement {
  const resolution = textures.resolution;
  const atlas = document.createElement('canvas');
  atlas.width = resolution * TERRAIN_PBR_ATLAS_COLUMNS;
  atlas.height = resolution * TERRAIN_PBR_ATLAS_ROWS;
  const context = atlas.getContext('2d');
  if (context === null) throw new Error('Could not create the terrain PBR atlas.');

  for (const [index, channel] of TERRAIN_PBR_CHANNELS.entries()) {
    const x = index % TERRAIN_PBR_ATLAS_COLUMNS;
    const y = Math.floor(index / TERRAIN_PBR_ATLAS_COLUMNS);
    context.drawImage(textures[channel].canvas, x * resolution, y * resolution);
  }
  return atlas;
}

export function splitTerrainPbrAtlas(
  atlas: CanvasImageSource,
  resolution: number
): TerrainPbrTextureSet {
  const tile = document.createElement('canvas');
  tile.width = resolution;
  tile.height = resolution;
  const context = tile.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Could not read the cached terrain PBR atlas.');

  const result: Partial<Record<TerrainPbrChannel, TerrainTextureSource>> = {};
  for (const [index, channel] of TERRAIN_PBR_CHANNELS.entries()) {
    const x = index % TERRAIN_PBR_ATLAS_COLUMNS;
    const y = Math.floor(index / TERRAIN_PBR_ATLAS_COLUMNS);
    context.clearRect(0, 0, resolution, resolution);
    context.drawImage(
      atlas,
      x * resolution,
      y * resolution,
      resolution,
      resolution,
      0,
      0,
      resolution,
      resolution
    );
    result[channel] = textureSourceFromContext(context, resolution, resolution);
  }
  return result as TerrainPbrTextureSet;
}
