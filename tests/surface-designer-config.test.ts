import { describe, expect, it } from 'vitest';
import {
  normalizeSurfaceDesignerConfig,
  SURFACE_DESIGNER_CONFIG
} from '../src/config/surfaceDesignerConfig';

function configDocument(): Record<string, unknown> {
  return structuredClone(SURFACE_DESIGNER_CONFIG) as unknown as Record<string, unknown>;
}

describe('surface designer configuration', () => {
  it('keeps micro-geometry defaults inside their configured limits', () => {
    const micro = SURFACE_DESIGNER_CONFIG.microGeometry;
    expect(micro.maxEdgeLength).toBeGreaterThanOrEqual(micro.limits.maxEdgeLength.min);
    expect(micro.maxEdgeLength).toBeLessThanOrEqual(micro.limits.maxEdgeLength.max);
    expect(micro.iterations).toBeGreaterThanOrEqual(micro.limits.iterations.min);
    expect(micro.iterations).toBeLessThanOrEqual(micro.limits.iterations.max);
    expect(micro.maxVertices).toBeGreaterThanOrEqual(micro.limits.maxVertices.min);
    expect(micro.maxVertices).toBeLessThanOrEqual(micro.limits.maxVertices.max);
  });

  it('rejects defaults outside configured limits', () => {
    const document = configDocument();
    const micro = document.microGeometry as Record<string, unknown>;
    const limits = micro.limits as Record<string, unknown>;
    const iterations = limits.iterations as Record<string, unknown>;
    iterations.max = 1;

    expect(() => normalizeSurfaceDesignerConfig(document)).toThrow(/iterations.*configured limits/iu);
  });

  it('requires integral limits for integer micro-geometry settings', () => {
    const document = configDocument();
    const micro = document.microGeometry as Record<string, unknown>;
    const limits = micro.limits as Record<string, unknown>;
    const maxVertices = limits.maxVertices as Record<string, unknown>;
    maxVertices.step = 10000.5;

    expect(() => normalizeSurfaceDesignerConfig(document)).toThrow(/maxVertices.*step.*integer/iu);
  });
});
