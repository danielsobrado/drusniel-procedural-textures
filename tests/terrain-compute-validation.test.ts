import { describe, expect, it } from 'vitest';
import { TerrainComputeEngine } from '../src/tile/TerrainComputeEngine';
import type { TerrainSettings } from '../src/tile/TerrainTypes';

const SETTINGS: TerrainSettings = {
  seed: 42,
  mountainCoverage: 0.46,
  mountainHeight: 0.6,
  ridgeSharpness: 1.6,
  detail: 0.22,
  riverDensity: 0.62,
  riverDepth: 0.04,
  wetnessRadius: 5,
  materialRepeat: 24
};

describe('terrain compute validation', () => {
  it('rejects ambiguous or invalid terrain seeds', async () => {
    const engine = new TerrainComputeEngine();
    await expect(engine.generate({ ...SETTINGS, seed: Number.NaN }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, seed: 1.5 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, seed: -0x8000_0001 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, seed: 0x1_0000_0000 }, 32)).rejects.toThrow();
  });

  it('rejects terrain shape settings outside supported ranges', async () => {
    const engine = new TerrainComputeEngine();
    await expect(engine.generate({ ...SETTINGS, mountainCoverage: Number.NaN }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, mountainCoverage: 1.01 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, mountainHeight: 1.51 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, ridgeSharpness: 0.49 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, ridgeSharpness: 8.01 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, detail: -0.01 }, 32)).rejects.toThrow();
    await expect(engine.generate({ ...SETTINGS, detail: 1.01 }, 32)).rejects.toThrow();
  });
});
