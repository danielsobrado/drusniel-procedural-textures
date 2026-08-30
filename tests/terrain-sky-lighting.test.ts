import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TERRAIN_CONFIG,
  TERRAIN_LIGHTING_PRESET_IDS
} from '../src/config/terrainConfig';
import {
  isTerrainLightingPresetId,
  TERRAIN_LIGHTING_PRESETS
} from '../src/tile/TerrainSkyLighting';

const PREVIEW_SOURCE = readFileSync(
  new URL('../src/tile/TerrainMeshPreview.ts', import.meta.url),
  'utf8'
);
const LIGHTING_SOURCE = readFileSync(
  new URL('../src/tile/TerrainSkyLighting.ts', import.meta.url),
  'utf8'
);

describe('terrain sky lighting', () => {
  it('defines exactly one preset per configured id', () => {
    const ids = TERRAIN_LIGHTING_PRESETS.map((preset) => preset.id);
    expect([...ids].sort()).toEqual([...TERRAIN_LIGHTING_PRESET_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves the shipped default and rejects unknown ids', () => {
    expect(isTerrainLightingPresetId(TERRAIN_CONFIG.lighting.preset)).toBe(true);
    expect(isTerrainLightingPresetId('midnight')).toBe(false);
  });

  it('keeps every preset inside a usable exposure and intensity range', () => {
    for (const preset of TERRAIN_LIGHTING_PRESETS) {
      expect(preset.exposure).toBeGreaterThan(0);
      expect(preset.exposure).toBeLessThan(4);
      expect(preset.sunIntensity).toBeGreaterThan(0);
      expect(preset.environmentIntensity).toBeGreaterThanOrEqual(0);
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('keeps studio neutral so material inspection has a fixed reference', () => {
    const studio = TERRAIN_LIGHTING_PRESETS.find((preset) => preset.id === 'studio');
    expect(studio?.usesSky).toBe(false);
    expect(studio?.horizon).toBe(TERRAIN_CONFIG.preview.skyColor);
    expect(TERRAIN_LIGHTING_PRESETS.filter((preset) => !preset.usesSky)).toHaveLength(1);
  });

  it('hides the sun disc while baking the environment', () => {
    // Preetham puts an enormous value in the sun disc; integrating it into the irradiance
    // blows the whole scene to white. This is the addon's own documented requirement.
    expect(LIGHTING_SOURCE).toContain("uniforms.showSunDisc!.value = 0");
    expect(LIGHTING_SOURCE).toContain('fromCubemap');
  });

  it('casts terrain shadows from the base layers only', () => {
    // Base masks partition the surface exactly, so they are a complete caster. The override
    // layers are coincident geometry at alphaTest 0.005 and would smear a solid shadow.
    expect(PREVIEW_SOURCE).toContain("mesh.castShadow = layer.kind === 'base'");
    expect(PREVIEW_SOURCE).toContain('mesh.receiveShadow = true');
  });

  it('caps grazing specular so the sky does not wash the ground out', () => {
    // specularF90 defaults to 1, which turns terrain into a sky mirror at the grazing
    // angles you get looking across the ground at eye level.
    expect(PREVIEW_SOURCE).toContain('specularIntensity: 0.2');
  });
});
