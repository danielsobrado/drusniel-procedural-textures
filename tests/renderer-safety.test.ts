import { describe, expect, it } from 'vitest';
import { rendererSafetyConfig } from '../src/config/rendererSafetyConfig';
import {
  DISPLACED_NORMAL_GLSL,
  FRAGMENT_GLSL,
  SHARED_GLSL
} from '../src/materials/PortableProceduralShader';

describe('renderer safety configuration', () => {
  it('keeps geometry displacement conservative while preserving normal detail', () => {
    expect(rendererSafetyConfig.displacement.geometrySoftLimit).toBeGreaterThan(0);
    expect(rendererSafetyConfig.displacement.geometrySoftLimit).toBeLessThanOrEqual(0.075);
    expect(rendererSafetyConfig.displacement.normalSoftLimit).toBeGreaterThanOrEqual(
      rendererSafetyConfig.displacement.geometrySoftLimit
    );
    expect(rendererSafetyConfig.displacement.normalSoftLimit).toBeLessThanOrEqual(0.1);
  });

  it('uses finite normal fallback thresholds', () => {
    expect(rendererSafetyConfig.normal.determinantEpsilon).toBeGreaterThan(0);
    expect(rendererSafetyConfig.normal.vectorEpsilon).toBeGreaterThan(0);
  });

  it('keeps direct wheel zoom responsive and bounded', () => {
    expect(rendererSafetyConfig.zoom.response).toBeGreaterThan(1);
    expect(rendererSafetyConfig.zoom.wheelSensitivity).toBeGreaterThan(0);
    expect(rendererSafetyConfig.zoom.wheelSensitivity).toBeLessThan(0.01);
    expect(rendererSafetyConfig.zoom.maxInputPixels).toBeGreaterThan(0);
    expect(rendererSafetyConfig.zoom.settleDistance).toBeGreaterThan(0);
  });
});

describe('portable renderer safety guards', () => {
  it('uses separate displacement limits for geometry and fragment normals', () => {
    expect(SHARED_GLSL).toContain('float labSoftLimitGeometryDisplacement(float value)');
    expect(SHARED_GLSL).toContain('float labSoftLimitNormalDisplacement(float value)');
    expect(SHARED_GLSL).toContain('return labSoftLimitGeometryDisplacement(displacement);');
    expect(FRAGMENT_GLSL).toContain(
      'surface.displacement = labSoftLimitNormalDisplacement(surface.displacement);'
    );
  });

  it('falls back from degenerate displaced normals', () => {
    expect(DISPLACED_NORMAL_GLSL).toContain('vec3 labNormalCandidate');
    expect(DISPLACED_NORMAL_GLSL).toContain('labNormalCandidateLengthSq');
    expect(DISPLACED_NORMAL_GLSL).toContain(': labBaseWorldNormal;');
  });
});
