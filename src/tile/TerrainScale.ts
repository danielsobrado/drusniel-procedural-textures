import { TERRAIN_CONFIG } from '../config/terrainConfig';

/**
 * Texture scale is authored in metres per tile because that is the number a game artist
 * reasons about, but `TerrainSettings.materialRepeat` stays a unitless repeat count so
 * existing `.ptlmap.json` recipes keep loading unchanged. The two round-trip exactly.
 */
export function metersPerTile(repeat: number): number {
  return TERRAIN_CONFIG.worldSize / repeat;
}

export function repeatForMeters(meters: number): number {
  return TERRAIN_CONFIG.worldSize / meters;
}

export function clampMetersPerTile(meters: number): number {
  const { minMetersPerTextureTile, maxMetersPerTextureTile } = TERRAIN_CONFIG.scale;
  if (!Number.isFinite(meters)) return TERRAIN_CONFIG.scale.metersPerTextureTile;
  return Math.max(minMetersPerTextureTile, Math.min(maxMetersPerTextureTile, meters));
}

/** Terrain world units for a real-world distance: `terrainSize` units span `worldSize` metres. */
export function metersToUnits(meters: number, terrainSize: number): number {
  return meters * terrainSize / TERRAIN_CONFIG.worldSize;
}

export function unitsToMeters(units: number, terrainSize: number): number {
  return units * TERRAIN_CONFIG.worldSize / terrainSize;
}

export function formatMetersPerTile(meters: number): string {
  return meters >= 10 ? meters.toFixed(0) : meters.toFixed(meters < 1 ? 2 : 1);
}
