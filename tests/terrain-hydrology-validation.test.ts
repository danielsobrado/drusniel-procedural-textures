import { describe, expect, it } from 'vitest';
import { buildTerrainFields } from '../src/tile/TerrainHydrology';
import type { TerrainSettings } from '../src/tile/TerrainTypes';

const SETTINGS: TerrainSettings = {
  seed: 1,
  mountainCoverage: 0.4,
  mountainHeight: 0.6,
  ridgeSharpness: 1.6,
  detail: 0.2,
  riverDensity: 0.5,
  riverDepth: 0.04,
  wetnessRadius: 3,
  materialRepeat: 24
};

const HEIGHT = new Float32Array(16).fill(0.5);

describe('terrain hydrology validation', () => {
  it('rejects invalid terrain dimensions', () => {
    expect(() => buildTerrainFields(new Float32Array(16), 0, SETTINGS, 'cpu')).toThrow();
    expect(() => buildTerrainFields(new Float32Array(15), 4, SETTINGS, 'cpu')).toThrow();
  });

  it('rejects non-finite terrain heights', () => {
    const height = HEIGHT.slice();
    height[7] = Number.NaN;
    expect(() => buildTerrainFields(height, 4, SETTINGS, 'cpu')).toThrow();
  });

  it('rejects hydrology settings that could create invalid output fields', () => {
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, riverDensity: Number.NaN }, 'cpu')).toThrow();
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, riverDensity: 1.1 }, 'cpu')).toThrow();
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, riverDepth: Number.NaN }, 'cpu')).toThrow();
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, riverDepth: 0.26 }, 'cpu')).toThrow();
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, wetnessRadius: 0 }, 'cpu')).toThrow();
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, wetnessRadius: 2.5 }, 'cpu')).toThrow();
    expect(() => buildTerrainFields(HEIGHT, 4, { ...SETTINGS, wetnessRadius: 13 }, 'cpu')).toThrow();
  });
});
