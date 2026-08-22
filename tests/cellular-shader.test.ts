import { describe, expect, it } from 'vitest';
import { cellularConfig } from '../src/materials/CellularConfig';
import { SHARED_GLSL } from '../src/materials/ProceduralShader';

describe('organic cellular shader', () => {
  it('uses a fused warped F1/F2 field instead of radial or hard polygonal cells', () => {
    expect(SHARED_GLSL).toContain('vec2 labWorleyF1F2Fast');
    expect(SHARED_GLSL).toContain('float labOrganicCellular');
    expect(SHARED_GLSL).toContain('float broadInterior = 1.0 - smoothstep');
    expect(SHARED_GLSL).toContain('float fused = mix(broadInterior, territory, 0.72);');
    expect(SHARED_GLSL).toContain('if (kind == 2) return labOrganicCellular(p);');
    expect(SHARED_GLSL).not.toContain('1.0 - smoothstep(0.15, 0.72, labWorley(p))');
  });

  it('limits the expensive Worley neighborhood to eight center-biased candidates', () => {
    expect(SHARED_GLSL).toContain('for (int x = 0; x <= 1; x++)');
    expect(SHARED_GLSL).toContain('for (int y = 0; y <= 1; y++)');
    expect(SHARED_GLSL).toContain('for (int z = 0; z <= 1; z++)');
    expect(SHARED_GLSL).not.toContain('for (int x = -1; x <= 1; x++)');
  });

  it('damps cellular displacement so persisted high values do not create scale-like relief', () => {
    expect(cellularConfig.displacement.gain).toBeGreaterThan(0);
    expect(cellularConfig.displacement.gain).toBeLessThan(0.6);
    expect(SHARED_GLSL).toContain('float labDisplacementGainForKind(int kind)');
    expect(SHARED_GLSL).toContain('labDisplacementGainForKind(kind)');
  });

  it('uses the reduced-octave path for expensive secondary biological fields', () => {
    expect(SHARED_GLSL).toContain('float labFbm3(vec3 p)');
    expect(SHARED_GLSL).toContain('float trunk = labVeinBand(labFbm3');
    expect(SHARED_GLSL).toContain('float tissue = labFbm3');
  });

  it('keeps the growth profile in a stable configured range', () => {
    expect(cellularConfig.sampling.jitter).toBeGreaterThan(0);
    expect(cellularConfig.sampling.jitter).toBeLessThan(1);
    expect(cellularConfig.warp.strength).toBeGreaterThan(0);
    expect(cellularConfig.interior.high).toBeGreaterThan(cellularConfig.interior.low);
    expect(cellularConfig.boundary.compression).toBeLessThan(0.1);
    expect(cellularConfig.breakup.strength).toBeGreaterThan(0);
    expect(cellularConfig.asymmetry.strength).toBeGreaterThan(0);
    expect(cellularConfig.output.floor).toBeGreaterThanOrEqual(0.35);
    expect(cellularConfig.output.floor + cellularConfig.output.gain).toBeLessThanOrEqual(0.75);
  });
});
