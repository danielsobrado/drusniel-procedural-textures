import { describe, expect, it } from 'vitest';
import { createDefaultLayer } from '../src/app/AppState';
import { DEFAULT_MATERIAL_ALGORITHMS } from '../src/core/material/MaterialAlgorithms';
import { materialSimulationFingerprint } from '../src/engine/SimulationAtlas';

describe('simulation atlas invalidation', () => {
  it('ignores unrelated layer seed changes', () => {
    const simulation = createDefaultLayer('reaction-diffusion');
    const noise = createDefaultLayer('fbm');
    const before = materialSimulationFingerprint([simulation, noise], DEFAULT_MATERIAL_ALGORITHMS);
    const after = materialSimulationFingerprint(
      [simulation, { ...noise, seed: noise.seed + 1 }],
      DEFAULT_MATERIAL_ALGORITHMS
    );

    expect(after).toBe(before);
  });

  it('invalidates when a simulation layer seed changes', () => {
    const simulation = createDefaultLayer('erosion');
    const noise = createDefaultLayer('fbm');
    const before = materialSimulationFingerprint([simulation, noise], DEFAULT_MATERIAL_ALGORITHMS);
    const after = materialSimulationFingerprint(
      [{ ...simulation, seed: simulation.seed + 1 }, noise],
      DEFAULT_MATERIAL_ALGORITHMS
    );

    expect(after).not.toBe(before);
  });
});
