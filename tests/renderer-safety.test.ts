import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rendererSafetyConfig } from '../src/config/rendererSafetyConfig';
import {
  DISPLACED_NORMAL_GLSL,
  FRAGMENT_GLSL,
  SHARED_GLSL
} from '../src/materials/PortableProceduralShader';

const labRendererSource = readFileSync(new URL('../src/engine/LabRenderer.ts', import.meta.url), 'utf8');

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

describe('renderer loss containment', () => {
  it('handles WebGPU device loss instead of continuing the render loop', () => {
    expect(labRendererSource).toContain(
      'this.renderer.onDeviceLost = (info) => this.handleRendererDeviceLost(info);'
    );
    expect(labRendererSource).toContain('cancelAnimationFrame(this.animationFrame);');
    expect(labRendererSource).toContain(
      'if (this.disposed || this.rendererInitializationError !== null) return;'
    );
    expect(labRendererSource).toContain("this.container.dataset.rendererState = 'unavailable';");
  });

  it('replaces a lost WebGL bake renderer and invalidates dependent helpers', () => {
    expect(labRendererSource).toContain('if (!current.getContext().isContextLost()) return current;');
    expect(labRendererSource).toContain('this.releaseBakeRenderer();');
    expect(labRendererSource).toContain('this.baker = null;');
    expect(labRendererSource).toContain('this.glbExporter = null;');
  });
});
