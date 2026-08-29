import { describe, expect, it } from 'vitest';
import {
  isZeroBaselineLayerKind,
  materialLayerRelief,
  ZERO_BASELINE_LAYER_KINDS
} from '../src/core/material/MaterialRelief';
import type { LayerKind } from '../src/core/material/RuntimeMaterial';
import { SHARED_GLSL } from '../src/materials/ProceduralShader';

const ALL_LAYER_KINDS: readonly LayerKind[] = [
  'base', 'fbm', 'cellular', 'ridges', 'spots', 'veins', 'gradient', 'vessels', 'wet-film',
  'sss', 'reaction-diffusion', 'erosion', 'sdf', 'pattern'
];

const SHAPED_SAMPLES = [0, 0.17, 0.5, 0.83, 1];

describe('material layer relief normalization', () => {
  it('stays within 0..1 for every layer kind, shaped value and displacement sign', () => {
    for (const kind of ALL_LAYER_KINDS) {
      for (const shaped of SHAPED_SAMPLES) {
        for (const displacement of [-0.18, -0.001, 0, 0.001, 0.18]) {
          const relief = materialLayerRelief(kind, shaped, displacement);
          expect(relief, `${kind} @ ${shaped} / ${displacement}`).toBeGreaterThanOrEqual(0);
          expect(relief, `${kind} @ ${shaped} / ${displacement}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('reads a raised sample higher than a recessed sample for every layer kind', () => {
    for (const kind of ALL_LAYER_KINDS) {
      const low = materialLayerRelief(kind, 0.2, 0.05);
      const high = materialLayerRelief(kind, 0.8, 0.05);
      expect(high, `${kind}`).toBeGreaterThan(low);
    }
  });

  it('mirrors relief about 0.5 when the source displacement is negative', () => {
    for (const kind of ALL_LAYER_KINDS) {
      for (const shaped of SHAPED_SAMPLES) {
        const raised = materialLayerRelief(kind, shaped, 0.05);
        const recessed = materialLayerRelief(kind, shaped, -0.05);
        expect(recessed, `${kind} @ ${shaped}`).toBeCloseTo(1 - raised, 10);
      }
    }
  });

  it('treats a zero displacement as raised so color-only layers stay usable as mask sources', () => {
    for (const kind of ALL_LAYER_KINDS) {
      expect(materialLayerRelief(kind, 0.7, 0), `${kind}`)
        .toBeCloseTo(materialLayerRelief(kind, 0.7, 0.05), 10);
    }
  });

  it('drives zero-baseline kinds to no relief where no material is present', () => {
    for (const kind of ZERO_BASELINE_LAYER_KINDS) {
      expect(materialLayerRelief(kind, 0, 0.05), `${kind}`).toBe(0);
      expect(materialLayerRelief(kind, 0.02, 0.05), `${kind}`).toBeLessThan(0.02);
    }
  });

  it('leaves dense field kinds on their shaped value so the threshold stays linear', () => {
    for (const kind of ALL_LAYER_KINDS) {
      if (isZeroBaselineLayerKind(kind)) continue;
      expect(materialLayerRelief(kind, 0.37, 0.05), `${kind}`).toBeCloseTo(0.37, 10);
    }
  });

  it('classifies exactly the kinds the base shader treats as zero-baseline, plus pattern', () => {
    expect([...ZERO_BASELINE_LAYER_KINDS].sort()).toEqual(['pattern', 'spots', 'vessels', 'veins'].sort());
    expect(SHARED_GLSL).toContain('bool labIsZeroBaselineKind(int kind)');
    expect(SHARED_GLSL).toContain('return kind == 4 || kind == 5 || kind == 7;');
  });

  it('exposes a relief helper in the base shader matching the reference composition', () => {
    expect(SHARED_GLSL).toContain('float labReliefForLayer(int layerIndex, vec3 position)');
    expect(SHARED_GLSL).toContain(
      'float relief = labIsZeroBaselineKind(kind) ? shaped * labLayerCoverage(kind, shaped) : shaped;'
    );
    expect(SHARED_GLSL).toContain('if (uLabDisplacement[layerIndex] < 0.0) relief = 1.0 - relief;');
  });
});
