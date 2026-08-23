import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { MATERIAL_PRESETS } from '../src/materials/presets';

const STONE_IDS = ['cut-cobble-stone', 'weathered-flagstone'] as const;

describe('stone presets', () => {
  it.each(STONE_IDS)('registers and applies %s', (id) => {
    const preset = MATERIAL_PRESETS.find((item) => item.id === id);
    expect(preset).toBeDefined();
    expect(preset?.tags).toContain('stone');

    const state = new AppState();
    expect(() => state.applyPreset(preset!)).not.toThrow();
  });

  it.each(STONE_IDS)('keeps %s non-metallic with recessed seams', (id) => {
    const preset = MATERIAL_PRESETS.find((item) => item.id === id);
    expect(preset?.physical?.metalness).toBe(0);
    expect(preset?.layers.some((item) => item.channel === 'height' && item.maskInvert)).toBe(true);
    expect(preset?.layers.some((item) => item.channel === 'roughness')).toBe(true);
  });
});
