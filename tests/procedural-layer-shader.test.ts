import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/materials/presets';
import { SHARED_GLSL } from '../src/materials/ProceduralShader';

describe('sparse procedural layers', () => {
  it('keeps geological veins directional, sparse and domain-warped', () => {
    expect(SHARED_GLSL).toContain('float labMineralVeins(vec3 p)');
    expect(SHARED_GLSL).toContain('float labPeriodicVeinBand(float value, float width)');
    expect(SHARED_GLSL).toContain('vec3 primaryNormal = normalize(vec3(0.74, 0.18, 0.65));');
    expect(SHARED_GLSL).toContain('float primaryCoordinate = dot(q, primaryNormal) * 0.19 + primaryWarp;');
    expect(SHARED_GLSL).toContain('float secondaryGate = smoothstep(');
    expect(SHARED_GLSL).toContain('float hairline = labPeriodicVeinBand');
    expect(SHARED_GLSL).toContain('if (kind == 5) return labMineralVeins(p);');
  });

  it('does not tint the full surface for spots, veins, or vessels', () => {
    expect(SHARED_GLSL).toContain('float labLayerCoverage(int kind, float shaped)');
    expect(SHARED_GLSL).toContain('if (kind == 4 || kind == 5 || kind == 7)');
    expect(SHARED_GLSL).toContain('return smoothstep(0.03, 0.92, shaped);');
  });

  it('uses zero-baseline displacement for sparse features', () => {
    expect(SHARED_GLSL).toContain('float labDisplacementSignal(int kind, float shaped)');
    expect(SHARED_GLSL).toContain('if (kind == 4 || kind == 5 || kind == 7) return shaped;');
    expect(SHARED_GLSL).toContain('labDisplacementSignal(kind, shaped)');
  });

  it('keeps polished marble relief subtle', () => {
    const marble = MATERIAL_PRESETS.find((preset) => preset.id === 'storm-marble');
    expect(marble).toBeDefined();

    const cloud = marble?.layers.find((layer) => layer.id === 'preset-marble-cloud');
    const veins = marble?.layers.find((layer) => layer.id === 'preset-marble-vein');
    expect(cloud?.displacement ?? 1).toBeLessThanOrEqual(0.004);
    expect(veins?.displacement ?? 1).toBeLessThanOrEqual(0.001);
  });
});
