import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultLayer } from '../src/app/AppState';
import { DEFAULT_MATERIAL_ALGORITHMS } from '../src/core/material/MaterialAlgorithms';
import { materialSimulationFingerprint } from '../src/engine/SimulationAtlas';

const compilerSource = readFileSync(
  new URL('../src/materials/MaterialCompiler.ts', import.meta.url),
  'utf8'
);

function algorithmsWith(
  patch: Partial<typeof DEFAULT_MATERIAL_ALGORITHMS>
): typeof DEFAULT_MATERIAL_ALGORITHMS {
  return { ...DEFAULT_MATERIAL_ALGORITHMS, ...patch };
}

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

  it('ignores SDF settings because they do not affect simulation fields', () => {
    const simulation = createDefaultLayer('reaction-diffusion');
    const before = materialSimulationFingerprint([simulation], DEFAULT_MATERIAL_ALGORITHMS);
    const after = materialSimulationFingerprint(
      [simulation],
      algorithmsWith({
        sdf: { ...DEFAULT_MATERIAL_ALGORITHMS.sdf, radius: 0.42 }
      })
    );

    expect(after).toBe(before);
  });

  it('scopes algorithm invalidation to the simulation kinds in use', () => {
    const reaction = createDefaultLayer('reaction-diffusion');
    const erosion = createDefaultLayer('erosion');
    const thermalChange = algorithmsWith({
      thermalErosion: {
        ...DEFAULT_MATERIAL_ALGORITHMS.thermalErosion,
        rate: DEFAULT_MATERIAL_ALGORITHMS.thermalErosion.rate + 0.1
      }
    });
    const reactionChange = algorithmsWith({
      reactionDiffusion: {
        ...DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion,
        feed: DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion.feed + 0.01
      }
    });

    expect(materialSimulationFingerprint([reaction], thermalChange)).toBe(
      materialSimulationFingerprint([reaction], DEFAULT_MATERIAL_ALGORITHMS)
    );
    expect(materialSimulationFingerprint([reaction], reactionChange)).not.toBe(
      materialSimulationFingerprint([reaction], DEFAULT_MATERIAL_ALGORITHMS)
    );
    expect(materialSimulationFingerprint([erosion], reactionChange)).toBe(
      materialSimulationFingerprint([erosion], DEFAULT_MATERIAL_ALGORITHMS)
    );
    expect(materialSimulationFingerprint([erosion], thermalChange)).not.toBe(
      materialSimulationFingerprint([erosion], DEFAULT_MATERIAL_ALGORITHMS)
    );
  });

  it('does not defeat scoped invalidation by clearing the compiler fingerprint', () => {
    expect(compilerSource).not.toContain("this.simulationFingerprint = '';");
  });
});
