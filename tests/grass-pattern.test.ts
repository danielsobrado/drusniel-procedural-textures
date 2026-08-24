import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATTERN_SETTINGS,
  GRASS_PATTERN_LIMITS,
  TURF_PATTERN_LIMITS,
  normalizePatternSettings
} from '../src/core/material/PatternSettings';
import { DENSE_GRASS_SURFACE_PRESET } from '../src/materials/denseGrassSurfacePreset';
import { GRASS_EXTENSION_PRESETS } from '../src/materials/grassExtensionPresets';
import { GRASS_PRESETS } from '../src/materials/grassPresets';
import { PATTERN_GLSL_HELPERS, PATTERN_KIND_CODE } from '../src/materials/PatternShader';
import { derivePatternParams } from '../src/materials/WebGpuPatternNodes';

const ALL_GRASS_PRESETS = [
  DENSE_GRASS_SURFACE_PRESET,
  ...GRASS_PRESETS,
  ...GRASS_EXTENSION_PRESETS
];

describe('vegetation pattern settings', () => {
  it('hydrates grass and turf controls with configured defaults', () => {
    const grass = normalizePatternSettings({
      kind: 'grass', aspect: 0.22, gap: 0.03, roundness: 0.1, jitter: 0.5,
      rotation: 0, offset: 0.5, density: 1.8, edgeWear: 0.1
    });
    const turf = normalizePatternSettings({
      kind: 'turf', aspect: 1, gap: 0.03, roundness: 0.1, jitter: 0.6,
      rotation: 0, offset: 0.5, density: 2.2, edgeWear: 0.12
    });

    expect(grass.bladeLength).toBe(DEFAULT_PATTERN_SETTINGS.bladeLength);
    expect(grass.clumpStrength).toBe(DEFAULT_PATTERN_SETTINGS.clumpStrength);
    expect(turf.fiberLength).toBe(DEFAULT_PATTERN_SETTINGS.fiberLength);
    expect(turf.fiberBreakup).toBe(DEFAULT_PATTERN_SETTINGS.fiberBreakup);
  });

  it('keeps explicit vegetation controls within declared limits', () => {
    const grass = normalizePatternSettings({
      ...DEFAULT_PATTERN_SETTINGS,
      kind: 'grass',
      bladeLength: 0.9,
      bladeWidth: 0.03,
      bladeTaper: 2.1,
      bladeBend: 0.14,
      clumpStrength: 0.8,
      directionality: 0.75,
      dryness: 0.2
    });
    const turf = normalizePatternSettings({
      ...DEFAULT_PATTERN_SETTINGS,
      kind: 'turf',
      fiberLength: 0.4,
      fiberWidth: 0.05,
      fiberBreakup: 0.7,
      fiberSoftness: 0.65
    });

    for (const [key, range] of Object.entries(GRASS_PATTERN_LIMITS)) {
      const value = grass[key as keyof typeof GRASS_PATTERN_LIMITS];
      expect(typeof value).toBe('number');
      expect(value as number).toBeGreaterThanOrEqual(range.min);
      expect(value as number).toBeLessThanOrEqual(range.max);
    }
    for (const [key, range] of Object.entries(TURF_PATTERN_LIMITS)) {
      const value = turf[key as keyof typeof TURF_PATTERN_LIMITS];
      expect(typeof value).toBe('number');
      expect(value as number).toBeGreaterThanOrEqual(range.min);
      expect(value as number).toBeLessThanOrEqual(range.max);
    }
  });

  it('feeds matching grass and turf controls to the WebGPU path', () => {
    const params = derivePatternParams({
      ...DEFAULT_PATTERN_SETTINGS,
      kind: 'turf',
      bladeLength: 0.91,
      bladeWidth: 0.027,
      clumpStrength: 0.77,
      directionality: 0.83,
      fiberLength: 0.39,
      fiberWidth: 0.047,
      fiberBreakup: 0.72,
      fiberSoftness: 0.68
    });

    expect(params.grassBladeLength).toBeCloseTo(0.91);
    expect(params.grassBladeWidth).toBeCloseTo(0.027);
    expect(params.grassClumpStrength).toBeCloseTo(0.77);
    expect(params.grassDirectionality).toBeCloseTo(0.83);
    expect(params.turfFiberLength).toBeCloseTo(0.39);
    expect(params.turfFiberWidth).toBeCloseTo(0.047);
    expect(params.turfFiberBreakup).toBeCloseTo(0.72);
    expect(params.turfFiberSoftness).toBeCloseTo(0.68);
  });
});

describe('vegetation shader architecture', () => {
  it('keeps explicit blades available but adds a separate matted turf generator', () => {
    expect(PATTERN_KIND_CODE.grass).not.toBe(PATTERN_KIND_CODE.turf);
    expect(PATTERN_GLSL_HELPERS).toContain('float labGrassBlade2d');
    expect(PATTERN_GLSL_HELPERS).toContain('float labTurfFiber2d');
    expect(PATTERN_GLSL_HELPERS).toContain('uLabTurfFiberBreakup');
    expect(PATTERN_GLSL_HELPERS).toContain('uLabTurfFiberSoftness');
    expect(PATTERN_GLSL_HELPERS).toContain('labPatternDisplacementGain');
  });
});

describe('grass presets', () => {
  it('uses turf as the dominant structure for lawn-like presets', () => {
    const turfDominant = [
      'designer-dense-grass',
      'lush-turf',
      'wild-meadow-grass',
      'dry-savanna-grass',
      'coastal-dune-grass',
      'forest-understory-grass',
      'frosted-grass'
    ];

    for (const id of turfDominant) {
      const preset = ALL_GRASS_PRESETS.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      expect(
        preset?.layers.some((layer) => layer.kind === 'pattern' && layer.pattern?.kind === 'turf'),
        id
      ).toBe(true);
    }
  });

  it('keeps blade patterns sparse where the material genuinely needs visible blades', () => {
    for (const preset of ALL_GRASS_PRESETS) {
      for (const layer of preset.layers) {
        if (layer.kind !== 'pattern' || layer.pattern?.kind !== 'grass') continue;
        expect(layer.opacity, `${preset.id}/${layer.name}`).toBeLessThanOrEqual(
          preset.id === 'wetland-sedge' ? 0.8 : 0.1
        );
      }
    }
  });

  it('keeps turf geometry displacement deliberately shallow', () => {
    for (const preset of ALL_GRASS_PRESETS) {
      for (const layer of preset.layers) {
        if (layer.kind !== 'pattern' || layer.pattern?.kind !== 'turf') continue;
        expect(Math.abs(layer.displacement), `${preset.id}/${layer.name}`).toBeLessThanOrEqual(0.005);
      }
    }
  });

  it('does not use spot generators for grass or thatch structure', () => {
    for (const preset of ALL_GRASS_PRESETS) {
      const vegetationLayers = preset.layers.filter((layer) =>
        /blade|grass|sedge|straw|turf|thatch|fiber|growth/i.test(layer.name)
      );
      for (const layer of vegetationLayers) {
        expect(layer.kind, `${preset.id}/${layer.name}`).not.toBe('spots');
      }
    }
  });
});
