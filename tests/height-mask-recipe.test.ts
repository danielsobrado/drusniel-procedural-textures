import { describe, expect, it } from 'vitest';
import {
  createMaterialRecipe,
  parseMaterialRecipe,
  PTL_MATERIAL_FORMAT,
  PTL_MATERIAL_VERSION
} from '../src/runtime/MaterialRecipe';
import { createPresetLayer } from '../src/materials/presetLayer';
import { PTL_DEFAULT_PHYSICAL, PTL_DEFAULT_SYNTHESIS } from '../src/core/material/runtimeDefaults';
import { STRUCTURED_SURFACE_PRESETS } from '../src/materials/structuredSurfacePresets';
import { setSurfaceGraphNodeParameter } from '../src/core/graph/SurfaceGraphMutation';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';
import type { MaterialLayer } from '../src/core/material/RuntimeMaterial';

function definition(mossOverrides: Partial<MaterialLayer> = {}) {
  return {
    physical: PTL_DEFAULT_PHYSICAL,
    synthesis: PTL_DEFAULT_SYNTHESIS,
    groups: [],
    layers: [
      createPresetLayer('bricks', 'Bricks', 'pattern', { displacement: 0.026 }),
      createPresetLayer('moss', 'Moss', 'fbm', { maskSourceLayerId: 'bricks', ...mossOverrides })
    ]
  };
}

describe('height mask recipe portability', () => {
  it('serializes at version 4', () => {
    const recipe = createMaterialRecipe(definition({ maskMode: 'height', maskThreshold: 0.4 }));
    expect(PTL_MATERIAL_VERSION).toBe(4);
    expect(recipe.version).toBe(4);
  });

  it('round-trips a height-masked layer', () => {
    const recipe = createMaterialRecipe(definition({
      maskMode: 'height',
      maskThreshold: 0.4,
      maskSoftness: 0.12,
      maskBreakup: 0.3
    }));
    const parsed = parseMaterialRecipe(JSON.parse(JSON.stringify(recipe)));
    const moss = parsed.layers[1]!;
    expect(moss.maskMode).toBe('height');
    expect(moss.maskThreshold).toBe(0.4);
    expect(moss.maskSoftness).toBe(0.12);
    expect(moss.maskBreakup).toBe(0.3);
  });

  it('rejects a height-masked layer in a pre-v4 recipe rather than silently downgrading it', () => {
    const recipe = createMaterialRecipe(definition({ maskMode: 'height' }));
    expect(() => parseMaterialRecipe({ ...recipe, version: 3 }))
      .toThrow(/Height-masked material recipes require version 4/);
  });

  it('still accepts a coverage-masked layer in older recipes', () => {
    const recipe = createMaterialRecipe(definition());
    for (const version of [1, 2, 3]) {
      const parsed = parseMaterialRecipe({ ...recipe, version, surfaceGraph: null });
      expect(parsed.version).toBe(PTL_MATERIAL_VERSION);
      expect(parsed.layers[1]!.maskMode).toBe('coverage');
    }
  });

  it('still gates texture fields on version 3, not on the bumped current version', () => {
    const recipe = createMaterialRecipe({
      ...definition(),
      layers: [
        createPresetLayer('stone', 'Stone', 'base', {
          texture: {
            id: 'rock.01', scaleX: 3, scaleY: 3, rotation: 0, offsetX: 0, offsetY: 0,
            contrast: 1.2, bias: 0, invert: false, clamp: true, channel: 'r', mode: 'replace', amount: 1
          }
        })
      ]
    });
    expect(() => parseMaterialRecipe({ ...recipe, version: 2, surfaceGraph: null }))
      .toThrow(/Texture-field material recipes require version 3/);
    expect(parseMaterialRecipe({ ...recipe, version: 3 }).version).toBe(PTL_MATERIAL_VERSION);
  });

  it('rejects an unknown version', () => {
    const recipe = createMaterialRecipe(definition());
    expect(() => parseMaterialRecipe({ ...recipe, version: 9 }))
      .toThrow(/Unsupported material recipe version/);
    expect(() => parseMaterialRecipe({ ...recipe, format: 'not-ptl' }))
      .toThrow(/not a Procedural Texture Lab material recipe/);
    expect(PTL_MATERIAL_FORMAT).toBe('ptl-material');
  });
});

describe('mossy brick wall preset', () => {
  const preset = STRUCTURED_SURFACE_PRESETS.find((item) => item.id === 'designer-mossy-brick-wall');

  it('is registered', () => {
    expect(preset).toBeDefined();
    expect(preset?.tags).toContain('moss');
  });

  it('places moss with an inverted height mask against the brick layer', () => {
    const moss = preset?.layers.find((layer) => layer.name === 'Mortar Joint Moss');
    const bricks = preset?.layers.find((layer) => layer.name === 'Running Bond Bricks');
    expect(moss?.maskMode).toBe('height');
    expect(moss?.maskInvert).toBe(true);
    expect(moss?.maskSourceLayerId).toBe(bricks?.id);
    expect(moss?.maskBreakup).toBeGreaterThan(0);
  });

  it('keeps the original brick preset on coverage masking', () => {
    const brick = STRUCTURED_SURFACE_PRESETS.find((item) => item.id === 'designer-old-brick-wall');
    expect(brick?.layers.every((layer) => layer.maskMode === 'coverage')).toBe(true);
  });

  it('exposes the moss line as a graph parameter', () => {
    expect(preset?.graph?.exposed.map((item) => item.id)).toContain('moss-line');
  });

  it('drives the runtime height threshold from that exposed parameter without detaching', () => {
    const next = setSurfaceGraphNodeParameter(preset!.graph!, 'joint-moss', 'threshold', 0.77);
    const moss = compileSurfaceGraph(next).layers.find((layer) => layer.name === 'Mortar Joint Moss');
    expect(moss?.maskThreshold).toBe(0.77);
    expect(moss?.maskMode).toBe('height');
  });
});
