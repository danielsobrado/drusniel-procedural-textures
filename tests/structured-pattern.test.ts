import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isStructuredPatternKind,
  structuredPatternConfig
} from '../src/config/structuredPatternConfig';
import { SHARED_GLSL } from '../src/materials/PortableProceduralShader';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';

const STRUCTURED_IDS = [
  'designer-old-brick-wall',
  'designer-clay-roof-tiles',
  'designer-weathered-planks',
  'designer-ceramic-tiles',
  'designer-woven-fabric',
  'designer-river-gravel',
  'designer-road-asphalt',
  'designer-cobblestone'
] as const;

const webGpuStructuredSource = readFileSync(
  new URL('../src/materials/WebGpuStructuredPatternNodes.ts', import.meta.url),
  'utf8'
);

describe('structured surface patterns', () => {
  it('uses sharp normal-weighted projection and bounded displacement gains', () => {
    expect(structuredPatternConfig.projection.sharpness).toBeGreaterThanOrEqual(4);
    for (const [kind, gain] of Object.entries(structuredPatternConfig.displacementGain)) {
      expect(isStructuredPatternKind(kind)).toBe(true);
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThan(1);
    }
  });

  it('keeps portable displacement and projection aligned with structured configuration', () => {
    for (const gain of Object.values(structuredPatternConfig.displacementGain)) {
      expect(SHARED_GLSL).toContain(`return ${gain.toFixed(6)}`);
    }
    expect(SHARED_GLSL).toContain(
      `mix(peak, average, ${structuredPatternConfig.projection.portableAverageMix.toFixed(6)})`
    );
  });

  it('keeps numeric structured controls uniform-driven in WebGPU', () => {
    expect(webGpuStructuredSource).not.toContain('settings.jitter');
    expect(webGpuStructuredSource).not.toContain('settings.edgeWear');
    expect(webGpuStructuredSource).toContain('params.cellJitterOffset');
    expect(webGpuStructuredSource).toContain('params.grassEdgeWear');
  });

  it('keeps every structured preset safe to read while building the library', () => {
    for (const id of STRUCTURED_IDS) {
      const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      expect(() => {
        void preset?.layers;
        void preset?.graph;
      }, id).not.toThrow();
    }
  });

  it('replaces the recent structured designer presets with shallow pattern-driven materials', () => {
    for (const id of STRUCTURED_IDS) {
      const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === id);
      expect(preset, id).toBeDefined();
      const patternLayers = preset?.layers.filter((layer) => layer.kind === 'pattern') ?? [];
      expect(patternLayers.length, id).toBeGreaterThan(0);
      for (const layer of patternLayers) {
        expect(Math.abs(layer.displacement), `${id}/${layer.name}`).toBeLessThanOrEqual(0.03);
      }
    }
  });

  it('keeps brick structure readable instead of using spot damage as the brick silhouette', () => {
    const brick = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    expect(brick).toBeDefined();
    const structure = brick?.layers.find((layer) => layer.name === 'Running Bond Bricks');
    expect(structure?.kind).toBe('pattern');
    expect(structure?.pattern?.kind).toBe('brick');
    expect(structure?.pattern?.gap).toBeGreaterThanOrEqual(0.1);
    expect(structure?.pattern?.aspect).toBeGreaterThan(2);
    expect(brick?.layers.some((layer) => layer.kind === 'spots')).toBe(false);
  });

  it('does not leave decorative processing chains in the replacement graphs', () => {
    for (const id of STRUCTURED_IDS) {
      const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === id);
      const graph = preset?.graph;
      expect(graph, id).toBeDefined();
      const executable = graph?.nodes.filter((node) => node.runtime !== undefined) ?? [];
      expect(executable.length, id).toBe(preset?.layers.length);
      expect(graph?.nodes.some((node) => node.kind === 'flood-fill')).toBe(false);
      expect(graph?.nodes.some((node) => node.kind === 'bevel')).toBe(false);
    }
  });
});
