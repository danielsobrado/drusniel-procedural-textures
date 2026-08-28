import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/materials/presets';
import { placePresetLayerBefore } from '../src/materials/PresetLayerOrder';
import { createPresetLayer } from '../src/materials/presetLayer';
import type { MaterialPreset } from '../src/materials/types';

function presetWith(ids: readonly string[]): MaterialPreset {
  return {
    id: 'order-test',
    name: 'Order test',
    description: 'Test preset',
    tags: [],
    layers: ids.map((id) => createPresetLayer(id, id, 'fbm'))
  };
}

describe('preset layer ordering', () => {
  it('moves only the requested source before its consumer', () => {
    const preset = presetWith(['base', 'consumer', 'detail', 'source', 'finish']);
    const ordered = placePresetLayerBefore(preset, 'source', 'consumer');

    expect(ordered.layers.map((layer) => layer.id)).toEqual([
      'base',
      'source',
      'consumer',
      'detail',
      'finish'
    ]);
    expect(preset.layers.map((layer) => layer.id)).toEqual([
      'base',
      'consumer',
      'detail',
      'source',
      'finish'
    ]);
  });

  it('does not clone or reorder a preset that is already correct', () => {
    const preset = presetWith(['base', 'source', 'consumer']);
    expect(placePresetLayerBefore(preset, 'source', 'consumer')).toBe(preset);
  });

  it('rejects missing explicit ordering targets', () => {
    const preset = presetWith(['base', 'consumer']);
    expect(() => placePresetLayerBefore(preset, 'source', 'consumer')).toThrow(/missing layer source/iu);
    expect(() => placePresetLayerBefore(preset, 'base', 'missing')).toThrow(/missing layer missing/iu);
  });

  it('keeps the mossy stone substrate before moss colonies', () => {
    const preset = MATERIAL_PRESETS.find((item) => item.id === 'mossy-stone');
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    const mesoIndex = preset.layers.findIndex((layer) => layer.id === 'preset-mossy-stone-meso');
    const colonyIndex = preset.layers.findIndex((layer) => layer.id === 'preset-mossy-stone-colonies');
    expect(mesoIndex).toBeGreaterThanOrEqual(0);
    expect(colonyIndex).toBeGreaterThan(mesoIndex);
  });
});
