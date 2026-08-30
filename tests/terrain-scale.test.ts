import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERRAIN_CONFIG } from '../src/config/terrainConfig';
import {
  clampMetersPerTile,
  formatMetersPerTile,
  metersPerTile,
  metersToUnits,
  repeatForMeters,
  unitsToMeters
} from '../src/tile/TerrainScale';

const PANEL_SOURCE = readFileSync(
  new URL('../src/ui/TerrainTileLabPanel.ts', import.meta.url),
  'utf8'
);

describe('terrain texture scale', () => {
  it('ships a game-realistic default instead of a 21 m texture tile', () => {
    expect(metersPerTile(TERRAIN_CONFIG.materialRepeat)).toBe(4);
    expect(TERRAIN_CONFIG.scale.metersPerTextureTile).toBe(4);
  });

  it('round-trips metres against the unitless repeat the recipe stores', () => {
    for (const meters of [0.5, 1, 2, 4, 7.5, 21.3, 64]) {
      expect(metersPerTile(repeatForMeters(meters))).toBeCloseTo(meters, 10);
    }
    expect(repeatForMeters(4)).toBe(128);
  });

  it('reaches the whole configured range, which the old 256 repeat ceiling did not', () => {
    const { minMetersPerTextureTile, maxMetersPerTextureTile } = TERRAIN_CONFIG.scale;
    expect(minMetersPerTextureTile).toBeLessThanOrEqual(0.5);
    // 0.5 m/tile needs repeat 1024; the validator used to cap at 256, i.e. 2 m.
    expect(repeatForMeters(minMetersPerTextureTile)).toBeLessThanOrEqual(1024);
    expect(clampMetersPerTile(0.001)).toBe(minMetersPerTextureTile);
    expect(clampMetersPerTile(9999)).toBe(maxMetersPerTextureTile);
    expect(clampMetersPerTile(Number.NaN)).toBe(TERRAIN_CONFIG.scale.metersPerTextureTile);
  });

  it('converts between metres and terrain world units', () => {
    const terrainSize = 10;
    expect(metersToUnits(TERRAIN_CONFIG.worldSize, terrainSize)).toBe(terrainSize);
    expect(unitsToMeters(terrainSize, terrainSize)).toBe(TERRAIN_CONFIG.worldSize);
    expect(unitsToMeters(metersToUnits(37, terrainSize), terrainSize)).toBeCloseTo(37, 10);
  });

  it('keeps the read-out legible across the range', () => {
    expect(formatMetersPerTile(0.5)).toBe('0.50');
    expect(formatMetersPerTile(4)).toBe('4.0');
    expect(formatMetersPerTile(64)).toBe('64');
  });

  it('authors optional per-material metres with an explicit global link', () => {
    expect(PANEL_SOURCE).toContain('data-material-scale-linked');
    expect(PANEL_SOURCE).toContain('data-material-scale=');
    expect(PANEL_SOURCE).toContain('this.settings.materialScales');
    expect(PANEL_SOURCE).toContain('delete overrides[material]');
    expect(PANEL_SOURCE).toContain('repeat ${Math.round(repeatForMeters(meters))}');
  });
});
