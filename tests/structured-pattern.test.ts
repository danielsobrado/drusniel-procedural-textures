import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isStructuredPatternKind,
  structuredPatternConfig
} from '../src/config/structuredPatternConfig';
import { SHARED_GLSL as BASE_SHARED_GLSL } from '../src/materials/ProceduralShader';
import { FRAGMENT_GLSL, SHARED_GLSL } from '../src/materials/PortableProceduralShader';
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

const webGpuPatternSource = readFileSync(
  new URL('../src/materials/WebGpuPatternNodes.ts', import.meta.url),
  'utf8'
);

const webGpuDesignerSource = readFileSync(
  new URL('../src/materials/WebGpuSurfaceDesignerNodes.ts', import.meta.url),
  'utf8'
);

const materialCompilerSource = readFileSync(
  new URL('../src/materials/MaterialCompiler.ts', import.meta.url),
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
      `pow(abs(labTriplanarNormal), vec3(${structuredPatternConfig.projection.sharpness.toFixed(6)}))`
    );
  });

  it('weights structured projections by the surface normal instead of taking a hard maximum', () => {
    const field = SHARED_GLSL.slice(SHARED_GLSL.indexOf('float labPatternField'));
    const body = field.slice(0, field.indexOf('\n}'));

    expect(body).toContain('(yz * weights.x + xz * weights.y + xy * weights.z) / totalWeight');
    // Grass and turf keep their own peak/average vegetation blend; nothing else may fall back
    // to an unweighted maximum, which is what produced a hard projection seam.
    expect(body).not.toContain('return max(xy, max(xz, yz));');
  });

  it('applies the pattern displacement gain in both the geometry and the shading pass', () => {
    const gainTerm = '(kind == 13 ? labPatternDisplacementGain(i) : 1.0)';

    const geometry = SHARED_GLSL.slice(SHARED_GLSL.indexOf('float labEvaluateDisplacement'));
    expect(geometry).toContain(gainTerm);

    const shading = FRAGMENT_GLSL.slice(FRAGMENT_GLSL.indexOf('surface.displacement +='));
    expect(shading).toContain(gainTerm);
  });

  it('keeps the gain off non-pattern layers, whose uLabPatternKind slot defaults to brick', () => {
    const gain = SHARED_GLSL.slice(SHARED_GLSL.indexOf('float labPatternDisplacementGain'));
    // The default fill is the brick code, so an ungated call would scale every non-pattern
    // layer by the brick gain instead of leaving it at 1.0.
    expect(gain).toContain(`if (kind == 0) return ${structuredPatternConfig.displacementGain.brick.toFixed(6)}`);
    for (const source of [SHARED_GLSL, FRAGMENT_GLSL]) {
      const calls = source.match(/labPatternDisplacementGain\(i\)/g) ?? [];
      const guarded = source.match(/kind == 13 \? labPatternDisplacementGain\(i\)/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      expect(guarded.length).toBe(calls.length);
    }
  });

  it('never routes a pattern layer through the compact bake profile', () => {
    // The compact profile bakes the unpatched base GLSL, which has no pattern support at all
    // — no labPatternField, no labPatternDisplacementGain — so the missing gain there is
    // unreachable only for as long as a pattern layer forces the portable profile.
    expect(BASE_SHARED_GLSL).not.toContain('labPatternField');
    expect(BASE_SHARED_GLSL).not.toContain('labPatternDisplacementGain');

    const kinds = /const COMPACT_BAKE_KINDS = new Set<MaterialLayer\['kind'\]>\(\[([^\]]*)\]/u
      .exec(materialCompilerSource)?.[1];
    expect(kinds).toBeDefined();
    expect(kinds).not.toContain("'pattern'");
  });

  it('keeps numeric structured controls uniform-driven in WebGPU', () => {
    const evaluator = webGpuPatternSource.slice(webGpuPatternSource.indexOf('function roundedCell'));
    expect(evaluator).not.toContain('settings.jitter');
    expect(evaluator).not.toContain('settings.edgeWear');
    expect(evaluator).toContain('params.cellJitterOffset');
    expect(evaluator).toContain('params.grassEdgeWear');
  });

  it('routes every TSL pattern through the shared portable evaluator', () => {
    expect(webGpuDesignerSource).toContain('buildWebGpuPatternField(');
    expect(webGpuDesignerSource).not.toContain('WebGpuStructuredPatternNodes');
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
