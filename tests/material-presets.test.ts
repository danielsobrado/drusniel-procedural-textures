import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CONTROL_RANGES, DEFAULT_PHYSICAL, MAX_LAYERS } from '../src/app/constants';
import { TEXTURE_LIBRARY_ASSET_IDS } from '../src/config/textureLibraryConfig';
import { HYBRID_TARGET_PRESET_IDS } from '../src/materials/hybridPresetEnhancements';
import { MATERIAL_PRESETS } from '../src/materials/presets';

const NEW_BIOLOGICAL_IDS = [
  'lobular-adipose',
  'vascular-adipose',
  'yellow-adipose',
  'fibrotic-fascia',
  'granulation-tissue',
  'necrotic-adipose'
] as const;

const EXPECTED_CATEGORY_IDS = {
  biological: ['adipose-v8', ...NEW_BIOLOGICAL_IDS],
  ice: ['glacial-cell-ice'],
  moss: [
    'forest-moss-carpet',
    'mossy-stone',
    'cushion-moss',
    'crustose-lichen',
    'bog-moss',
    'sheet-moss',
    'reindeer-lichen'
  ],
  terrain: [
    'forest-loam',
    'red-clay-ground',
    'alpine-scree',
    'coastal-sand',
    'volcanic-soil',
    'riverbank-mud',
    'limestone-gravel'
  ],
  grass: [
    'lush-turf',
    'wild-meadow-grass',
    'dry-savanna-grass',
    'coastal-dune-grass',
    'forest-understory-grass',
    'wetland-sedge',
    'frosted-grass'
  ]
} as const;
const MAX_BASELINE_ROUGHNESS = 0.95;
const TEXTURE_LIBRARY_ID_SET = new Set(TEXTURE_LIBRARY_ASSET_IDS);

function expectInRange(value: number, min: number, max: number, label: string): void {
  expect(value, `${label} minimum`).toBeGreaterThanOrEqual(min);
  expect(value, `${label} maximum`).toBeLessThanOrEqual(max);
}

describe('material preset catalog', () => {
  it.each(Object.entries(EXPECTED_CATEGORY_IDS))('includes the %s presets', (tag, ids) => {
    const taggedIds = MATERIAL_PRESETS
      .filter((preset) => preset.tags.includes(tag))
      .map((preset) => preset.id);

    for (const id of ids) expect(taggedIds).toContain(id);
  });

  it('keeps preset and layer ids globally unique', () => {
    const presetIds = MATERIAL_PRESETS.map((preset) => preset.id);
    const layerIds = MATERIAL_PRESETS.flatMap((preset) => preset.layers.map((layer) => layer.id));

    expect(new Set(presetIds).size).toBe(presetIds.length);
    expect(new Set(layerIds).size).toBe(layerIds.length);
  });

  it('keeps every preset within the renderer layer budget', () => {
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.layers.length).toBeGreaterThan(0);
      expect(preset.layers.length).toBeLessThanOrEqual(MAX_LAYERS);
    }
  });

  it('keeps every layer control inside configured UI ranges', () => {
    const ranges = CONTROL_RANGES.layer;

    for (const preset of MATERIAL_PRESETS) {
      for (const layer of preset.layers) {
        const label = `${preset.id}/${layer.id}`;
        expectInRange(layer.opacity, ranges.opacity.min, ranges.opacity.max, `${label} opacity`);
        expectInRange(layer.scale, ranges.scale.min, ranges.scale.max, `${label} scale`);
        expectInRange(layer.strength, ranges.strength.min, ranges.strength.max, `${label} strength`);
        expectInRange(layer.seed, ranges.seed.min, ranges.seed.max, `${label} seed`);
        expectInRange(layer.roughness, ranges.roughness.min, ranges.roughness.max, `${label} roughness`);
        expectInRange(
          layer.displacement,
          ranges.displacement.min,
          ranges.displacement.max,
          `${label} displacement`
        );
        expectInRange(
          layer.maskStrength,
          ranges.maskStrength.min,
          ranges.maskStrength.max,
          `${label} mask strength`
        );
      }
    }
  });

  it('keeps every hybrid texture dependency in the texture library', () => {
    for (const preset of MATERIAL_PRESETS) {
      for (const layer of preset.layers) {
        if (layer.texture === null || layer.texture === undefined) continue;
        expect(TEXTURE_LIBRARY_ID_SET.has(layer.texture.id), `${preset.id}/${layer.id}`).toBe(true);
      }
    }
  });

  it('hybridizes every selected quality preset', () => {
    for (const id of HYBRID_TARGET_PRESET_IDS) {
      const preset = MATERIAL_PRESETS.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      if (preset === undefined) continue;

      expect(preset.tags, `${id} hybrid tag`).toContain('hybrid');
      expect(
        preset.layers.some((item) => item.texture !== null && item.texture !== undefined),
        `${id} texture field`
      ).toBe(true);
    }
  });

  it('keeps layer masks local to their preset', () => {
    for (const preset of MATERIAL_PRESETS) {
      const layerIds = new Set(preset.layers.map((layer) => layer.id));
      for (const layer of preset.layers) {
        if (layer.maskSourceLayerId !== null) {
          expect(layerIds.has(layer.maskSourceLayerId)).toBe(true);
        }
      }
    }
  });

  it('applies every preset through runtime normalization', () => {
    const state = new AppState();

    for (const preset of MATERIAL_PRESETS) {
      expect(() => state.applyPreset(preset), preset.id).not.toThrow();
      expect(state.snapshot.layers).toHaveLength(preset.layers.length);
      expect(state.snapshot.groups).toHaveLength(preset.groups?.length ?? 0);
    }
  });

  it('keeps roughness headroom for procedural variation', () => {
    for (const preset of MATERIAL_PRESETS) {
      const physicalRoughness = preset.physical?.roughness ?? DEFAULT_PHYSICAL.roughness;
      const baseRoughness = preset.layers.find((layer) => layer.kind === 'base')?.roughness ?? 0;

      expect(physicalRoughness + baseRoughness, preset.id).toBeLessThan(MAX_BASELINE_ROUGHNESS);
    }
  });

  it('keeps terrain and moss macro cellular structure procedural', () => {
    const ids = [...EXPECTED_CATEGORY_IDS.terrain, ...EXPECTED_CATEGORY_IDS.moss];
    for (const id of ids) {
      const preset = MATERIAL_PRESETS.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      if (preset === undefined) continue;

      for (const structural of preset.layers.filter((item) => item.kind === 'cellular')) {
        expect(structural.texture ?? null, `${id}/${structural.id}`).toBeNull();
      }
    }
  });

  it('keeps new biological presets multi-scale and physically layered', () => {
    for (const id of NEW_BIOLOGICAL_IDS) {
      const preset = MATERIAL_PRESETS.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      if (preset === undefined) continue;

      const kinds = new Set(preset.layers.map((layer) => layer.kind));
      expect(kinds.has('fbm') || kinds.has('cellular') || kinds.has('ridges'), `${id} structural detail`).toBe(true);
      expect(kinds.has('sss'), `${id} subsurface layer`).toBe(true);
      expect(kinds.has('wet-film'), `${id} wet-film layer`).toBe(true);

      for (const structural of preset.layers.filter((item) => item.kind === 'cellular' || item.kind === 'vessels')) {
        expect(structural.texture ?? null, `${id}/${structural.id}`).toBeNull();
      }
    }
  });

  it('keeps grass geometry procedural while texture fields control substrate and coverage', () => {
    for (const id of EXPECTED_CATEGORY_IDS.grass) {
      const preset = MATERIAL_PRESETS.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      if (preset === undefined) continue;

      const patterns = preset.layers.filter((item) => item.kind === 'pattern');
      expect(patterns.length, `${id} pattern layers`).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(pattern.texture ?? null, `${id}/${pattern.id}`).toBeNull();
      }

      expect(
        preset.layers.some((item) => item.kind !== 'pattern' && item.texture !== null && item.texture !== undefined),
        `${id} hybrid substrate`
      ).toBe(true);
    }
  });

  it('keeps glacial ice procedural at cell scale and hybrid internally', () => {
    const preset = MATERIAL_PRESETS.find((item) => item.id === 'glacial-cell-ice');
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    const structure = preset.layers.find((item) => item.id === 'preset-ice-glacial-cells');
    const textureIds = preset.layers.flatMap((item) => item.texture === null || item.texture === undefined
      ? []
      : [item.texture.id]
    );

    expect(structure?.kind).toBe('cellular');
    expect(structure?.texture ?? null).toBeNull();
    expect(preset.layers).toHaveLength(MAX_LAYERS);
    expect(textureIds).toEqual(expect.arrayContaining([
      'crystal.01',
      'cracks.02',
      'milky.02',
      'super-noise.02'
    ]));
  });

  it('keeps cut cobble procedural at macro scale and hybrid at meso and micro scales', () => {
    const preset = MATERIAL_PRESETS.find((item) => item.id === 'cut-cobble-stone');
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    const structure = preset.layers.find((item) => item.id === 'preset-stone-cut-cobble-structure');
    const cracks = preset.layers.find((item) => item.id === 'preset-stone-cut-cobble-cracks');
    const textureIds = preset.layers.flatMap((item) => item.texture === null || item.texture === undefined
      ? []
      : [item.texture.id]
    );

    expect(structure?.kind).toBe('sdf');
    expect(structure?.texture ?? null).toBeNull();
    expect(textureIds).toEqual(expect.arrayContaining(['stone.02', 'cracks.04', 'super-noise.04']));
    expect(cracks?.channel).toBe('height');
    expect(cracks?.maskSourceLayerId).toBe(structure?.id);
    expect(Math.abs(cracks?.displacement ?? 1)).toBeLessThan(0.02);
  });

  it('keeps weathered flagstone physically layered and editable', () => {
    const preset = MATERIAL_PRESETS.find((item) => item.id === 'weathered-flagstone');
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    expect(preset.layers.length).toBeLessThan(MAX_LAYERS);
    expect(preset.physical?.clearcoat).toBe(0);
    expect(preset.physical?.roughness).toBeGreaterThanOrEqual(0.68);
    expect(preset.physical?.specularIntensity).toBeLessThanOrEqual(0.4);

    const structure = preset.layers.find((item) => item.id === 'preset-stone-weathered-flagstone-structure');
    const seams = preset.layers.find((item) => item.id === 'preset-stone-weathered-flagstone-seams');
    const fractures = preset.layers.find((item) => item.id === 'preset-stone-weathered-flagstone-secondary-fractures');
    const grain = preset.layers.find((item) => item.id === 'preset-stone-weathered-flagstone-grain');
    const cavityAo = preset.layers.find((item) => item.id === 'preset-stone-weathered-flagstone-cavity-ao');
    const textureIds = preset.layers.flatMap((item) => item.texture === null || item.texture === undefined
      ? []
      : [item.texture.id]
    );

    expect(structure?.channel).toBe('height');
    expect(structure?.texture ?? null).toBeNull();
    expect(seams?.blendMode).toBe('multiply');
    expect(fractures?.kind).toBe('veins');
    expect(fractures?.displacement).toBeLessThan(0);
    expect(grain?.scale).toBeGreaterThan(15);
    expect(grain?.displacement).toBeLessThan(0);
    expect(cavityAo?.channel).toBe('ao');
    expect(cavityAo?.maskSourceLayerId).toBe(structure?.id);
    expect(cavityAo?.maskInvert).toBe(true);
    expect(textureIds).toEqual(expect.arrayContaining(['stone.03', 'grainy.05', 'super-noise.05']));
  });
});
