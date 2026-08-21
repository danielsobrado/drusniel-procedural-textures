import { parse } from 'yaml';
import rawConfig from '../../config/tile.yaml?raw';

export interface TileConfig {
  previewResolution: number;
  worldSize: number;
  blendFraction: number;
  previewTiles: number;
  minPreviewTiles: number;
  maxPreviewTiles: number;
  fileSuffix: string;
}

const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]*$/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Tile configuration must be an object.');
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid tile configuration value: ${name}.`);
  }
  return value;
}

function asInteger(value: unknown, name: string, min: number, max: number): number {
  const parsed = asNumber(value, name, min, max);
  if (!Number.isInteger(parsed)) throw new Error(`Tile configuration ${name} must be an integer.`);
  return parsed;
}

function asPowerOfTwo(value: unknown, name: string, min: number, max: number): number {
  const parsed = asInteger(value, name, min, max);
  if ((parsed & (parsed - 1)) !== 0) {
    throw new Error(`Tile configuration ${name} must be a power of two.`);
  }
  return parsed;
}

function asFilename(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SAFE_FILENAME.test(value)) {
    throw new Error(`Invalid tile configuration filename: ${name}.`);
  }
  return value;
}

function parseTileConfig(value: unknown): TileConfig {
  const config = asRecord(value);
  const minPreviewTiles = asInteger(config.minPreviewTiles, 'minPreviewTiles', 2, 8);
  const maxPreviewTiles = asInteger(config.maxPreviewTiles, 'maxPreviewTiles', minPreviewTiles, 8);
  return {
    previewResolution: asPowerOfTwo(config.previewResolution, 'previewResolution', 128, 4096),
    worldSize: asNumber(config.worldSize, 'worldSize', 0.1, 100),
    blendFraction: asNumber(config.blendFraction, 'blendFraction', 0.01, 0.49),
    previewTiles: asInteger(config.previewTiles, 'previewTiles', minPreviewTiles, maxPreviewTiles),
    minPreviewTiles,
    maxPreviewTiles,
    fileSuffix: asFilename(config.fileSuffix, 'fileSuffix')
  };
}

export const TILE_CONFIG = parseTileConfig(parse(rawConfig) as unknown);
