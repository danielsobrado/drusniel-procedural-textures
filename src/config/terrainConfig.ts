import { parse } from 'yaml';
import rawConfig from '../../config/terrain.yaml?raw';

export interface TerrainConfig {
  resolution: number;
  worldSize: number;
  heightScale: number;
  meshSegments: number;
  materialRepeat: number;
  mountains: {
    coverage: number;
    height: number;
    ridgeSharpness: number;
    detail: number;
  };
  hydrology: {
    riverDensity: number;
    riverDepth: number;
    wetnessRadius: number;
    minRiverCoverage: number;
    maxRiverCoverage: number;
    riverMaxThreshold: number;
    riverBankFalloff: number;
  };
  painting: {
    radius: number;
    hardness: number;
    strength: number;
  };
  materials: {
    presetBakeResolution: number;
  };
  player: {
    eyeHeightMeters: number;
    walkSpeedMetersPerSecond: number;
    sprintMultiplier: number;
    mouseSensitivity: number;
    maxPitchDegrees: number;
    nearClipMeters: number;
    tileRadius: number;
    fogStartMeters: number;
    fogEndMeters: number;
  };
  imports: {
    maxFileBytes: number;
    maxDimension: number;
  };
  preview: {
    maxPixels: number;
    riverWidthPixels: number;
    riverOpacity: number;
    riverColor: number;
    riverOffsetMeters: number;
    riverRoughness: number;
    riverAlphaStart: number;
    riverAlphaEnd: number;
    skyColor: number;
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function asInteger(value: unknown, label: string, min: number, max: number): number {
  const parsed = asNumber(value, label, min, max);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

function asPowerOfTwo(value: unknown, label: string, min: number, max: number): number {
  const parsed = asInteger(value, label, min, max);
  if ((parsed & (parsed - 1)) !== 0) throw new Error(`${label} must be a power of two.`);
  return parsed;
}

function requireAscendingRange(min: number, max: number, label: string): void {
  if (max <= min) throw new Error(`${label} maximum must be greater than its minimum.`);
}

function parseTerrainConfig(value: unknown): TerrainConfig {
  const config = asRecord(value, 'Terrain configuration');
  const mountains = asRecord(config.mountains, 'Terrain mountains configuration');
  const hydrology = asRecord(config.hydrology, 'Terrain hydrology configuration');
  const painting = asRecord(config.painting, 'Terrain painting configuration');
  const materials = asRecord(config.materials, 'Terrain materials configuration');
  const player = asRecord(config.player, 'Terrain player configuration');
  const imports = asRecord(config.imports, 'Terrain import configuration');
  const preview = asRecord(config.preview, 'Terrain preview configuration');
  const fogStartMeters = asNumber(player.fogStartMeters, 'player.fogStartMeters', 10, 4096);
  const fogEndMeters = asNumber(player.fogEndMeters, 'player.fogEndMeters', fogStartMeters, 8192);
  const minRiverCoverage = asNumber(
    hydrology.minRiverCoverage,
    'hydrology.minRiverCoverage',
    0,
    0.2
  );
  const maxRiverCoverage = asNumber(
    hydrology.maxRiverCoverage,
    'hydrology.maxRiverCoverage',
    minRiverCoverage,
    0.3
  );
  requireAscendingRange(minRiverCoverage, maxRiverCoverage, 'hydrology river coverage');
  const riverAlphaStart = asNumber(preview.riverAlphaStart, 'preview.riverAlphaStart', 0, 1);
  const riverAlphaEnd = asNumber(preview.riverAlphaEnd, 'preview.riverAlphaEnd', riverAlphaStart, 1);
  requireAscendingRange(riverAlphaStart, riverAlphaEnd, 'preview river alpha');
  return {
    resolution: asPowerOfTwo(config.resolution, 'resolution', 64, 512),
    worldSize: asNumber(config.worldSize, 'worldSize', 16, 8192),
    heightScale: asNumber(config.heightScale, 'heightScale', 1, 2048),
    meshSegments: asInteger(config.meshSegments, 'meshSegments', 16, 256),
    materialRepeat: asNumber(config.materialRepeat, 'materialRepeat', 1, 256),
    mountains: {
      coverage: asNumber(mountains.coverage, 'mountains.coverage', 0, 1),
      height: asNumber(mountains.height, 'mountains.height', 0, 1.5),
      ridgeSharpness: asNumber(mountains.ridgeSharpness, 'mountains.ridgeSharpness', 0.5, 8),
      detail: asNumber(mountains.detail, 'mountains.detail', 0, 1)
    },
    hydrology: {
      riverDensity: asNumber(hydrology.riverDensity, 'hydrology.riverDensity', 0, 1),
      riverDepth: asNumber(hydrology.riverDepth, 'hydrology.riverDepth', 0, 0.25),
      wetnessRadius: asInteger(hydrology.wetnessRadius, 'hydrology.wetnessRadius', 1, 12),
      minRiverCoverage,
      maxRiverCoverage,
      riverMaxThreshold: asNumber(
        hydrology.riverMaxThreshold,
        'hydrology.riverMaxThreshold',
        0.5,
        0.999
      ),
      riverBankFalloff: asNumber(
        hydrology.riverBankFalloff,
        'hydrology.riverBankFalloff',
        0,
        1
      )
    },
    painting: {
      radius: asNumber(painting.radius, 'painting.radius', 0.002, 0.25),
      hardness: asNumber(painting.hardness, 'painting.hardness', 0, 1),
      strength: asNumber(painting.strength, 'painting.strength', 0.01, 1)
    },
    materials: {
      presetBakeResolution: asPowerOfTwo(
        materials.presetBakeResolution,
        'materials.presetBakeResolution',
        128,
        1024
      )
    },
    player: {
      eyeHeightMeters: asNumber(player.eyeHeightMeters, 'player.eyeHeightMeters', 0.5, 4),
      walkSpeedMetersPerSecond: asNumber(player.walkSpeedMetersPerSecond, 'player.walkSpeedMetersPerSecond', 0.5, 30),
      sprintMultiplier: asNumber(player.sprintMultiplier, 'player.sprintMultiplier', 1, 5),
      mouseSensitivity: asNumber(player.mouseSensitivity, 'player.mouseSensitivity', 0.0001, 0.02),
      maxPitchDegrees: asNumber(player.maxPitchDegrees, 'player.maxPitchDegrees', 30, 89),
      nearClipMeters: asNumber(player.nearClipMeters, 'player.nearClipMeters', 0.01, 2),
      tileRadius: asInteger(player.tileRadius, 'player.tileRadius', 1, 2),
      fogStartMeters,
      fogEndMeters
    },
    imports: {
      maxFileBytes: asInteger(imports.maxFileBytes, 'imports.maxFileBytes', 1024, 256 * 1024 * 1024),
      maxDimension: asInteger(imports.maxDimension, 'imports.maxDimension', 64, 16384)
    },
    preview: {
      maxPixels: asInteger(preview.maxPixels, 'preview.maxPixels', 65536, 8_000_000),
      riverWidthPixels: asInteger(preview.riverWidthPixels, 'preview.riverWidthPixels', 1, 8),
      riverOpacity: asNumber(preview.riverOpacity, 'preview.riverOpacity', 0.1, 1),
      riverColor: asInteger(preview.riverColor, 'preview.riverColor', 0, 0xffffff),
      riverOffsetMeters: asNumber(preview.riverOffsetMeters, 'preview.riverOffsetMeters', 0.01, 5),
      riverRoughness: asNumber(preview.riverRoughness, 'preview.riverRoughness', 0, 1),
      riverAlphaStart,
      riverAlphaEnd,
      skyColor: asInteger(preview.skyColor, 'preview.skyColor', 0, 0xffffff)
    }
  };
}

export const TERRAIN_CONFIG = parseTerrainConfig(parse(rawConfig) as unknown);
