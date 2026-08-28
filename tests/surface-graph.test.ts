import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import type { SurfaceGraphDefinition } from '../src/core/graph/SurfaceGraph';
import { SURFACE_GRAPH_NODE_SPECS } from '../src/core/graph/SurfaceGraphCatalog';
import { normalizeSurfaceGraph } from '../src/core/graph/SurfaceGraphValidation';
import { PTL_MAX_LAYERS } from '../src/core/material/runtimeDefaults';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';

function designerGraph(): SurfaceGraphDefinition {
  const graph = SURFACE_DESIGNER_CATALOG[0]?.graph;
  if (graph === undefined) throw new Error('Designer test graph is missing.');
  return structuredClone(graph);
}

function runtimeBinding(graph: Record<string, unknown>): Record<string, unknown> {
  const nodes = graph.nodes as Array<Record<string, unknown>>;
  const runtime = nodes.find((node) => node.runtime !== undefined)?.runtime;
  if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) {
    throw new Error('Designer test graph has no runtime-bound node.');
  }
  return runtime as Record<string, unknown>;
}

describe('surface designer graphs', () => {
  it('exposes the core Substance-style node families', () => {
    const kinds = new Set(SURFACE_GRAPH_NODE_SPECS.map((spec) => spec.kind));
    for (const kind of [
      'shape',
      'tile-sampler',
      'shape-splatter',
      'flood-fill',
      'bevel',
      'slope-blur',
      'directional-warp',
      'gradient-map',
      'transform-2d',
      'height-to-normal',
      'sdf',
      'subgraph',
      'output'
    ] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it('normalizes and compiles every designer preset within the runtime budget', () => {
    expect(SURFACE_DESIGNER_CATALOG.length).toBeGreaterThanOrEqual(10);
    for (const preset of SURFACE_DESIGNER_CATALOG) {
      expect(preset.graph).toBeDefined();
      if (preset.graph === undefined) throw new Error(`${preset.name} has no graph.`);
      const normalized = normalizeSurfaceGraph(preset.graph);
      const compiled = compileSurfaceGraph(normalized);
      expect(compiled.layers.length).toBeGreaterThan(0);
      expect(compiled.layers.length).toBeLessThanOrEqual(PTL_MAX_LAYERS);
      expect(compiled.layers).toEqual(preset.layers);
      for (const layer of compiled.layers) {
        if (layer.kind === 'pattern') expect(layer.pattern).not.toBeNull();
      }
    }
  });

  it('rejects cycles in authored surface graphs', () => {
    const graph: SurfaceGraphDefinition = {
      version: 1,
      id: 'cycle-test',
      name: 'Cycle test',
      nodes: [
        { id: 'a', kind: 'levels', label: 'A', position: { x: 0, y: 0 }, params: {} },
        { id: 'b', kind: 'levels', label: 'B', position: { x: 100, y: 0 }, params: {} }
      ],
      edges: [
        { from: { nodeId: 'a', port: 'height' }, to: { nodeId: 'b', port: 'height' } },
        { from: { nodeId: 'b', port: 'height' }, to: { nodeId: 'a', port: 'height' } }
      ],
      outputs: [{ channel: 'height', source: { nodeId: 'b', port: 'height' } }],
      exposed: [],
      groups: [],
      subgraphs: []
    };
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/cycle/iu);
  });

  it('rejects malformed runtime values instead of coercing them', () => {
    const graph = designerGraph() as unknown as Record<string, unknown>;
    const runtime = runtimeBinding(graph);
    runtime.maskInvert = 'false';
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/mask invert.*boolean/iu);

    runtime.maskInvert = false;
    runtime.channel = 'not-a-channel';
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/channel.*unsupported/iu);
  });

  it('rejects invalid graph ports and runtime references', () => {
    const graph = designerGraph() as unknown as Record<string, unknown>;
    graph.edges = [{
      from: { nodeId: 'brick-shape', port: 'missing' },
      to: { nodeId: 'brick-tiles', port: 'pattern' }
    }];
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/missing output port/iu);

    graph.edges = [];
    const runtime = runtimeBinding(graph);
    runtime.structureFrom = 'missing-node';
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/missing runtime structure source/iu);
  });

  it('rejects incompatible graph edge types', () => {
    const graph: SurfaceGraphDefinition = {
      version: 1,
      id: 'edge-type-test',
      name: 'Edge type test',
      nodes: [
        { id: 'color', kind: 'gradient-map', label: 'Color', position: { x: 0, y: 0 }, params: {} },
        { id: 'levels', kind: 'levels', label: 'Levels', position: { x: 160, y: 0 }, params: {} }
      ],
      edges: [
        { from: { nodeId: 'color', port: 'color' }, to: { nodeId: 'levels', port: 'height' } }
      ],
      outputs: [],
      exposed: [],
      groups: [],
      subgraphs: []
    };
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/cannot connect.*color.*height/iu);
  });

  it('rejects ambiguous graph inputs and duplicate output channels', () => {
    const graph: SurfaceGraphDefinition = {
      version: 1,
      id: 'ambiguous-test',
      name: 'Ambiguous test',
      nodes: [
        { id: 'a', kind: 'shape', label: 'A', position: { x: 0, y: 0 }, params: {} },
        { id: 'b', kind: 'shape', label: 'B', position: { x: 0, y: 100 }, params: {} },
        { id: 'blend', kind: 'blend', label: 'Blend', position: { x: 180, y: 50 }, params: {} }
      ],
      edges: [
        { from: { nodeId: 'a', port: 'height' }, to: { nodeId: 'blend', port: 'background' } },
        { from: { nodeId: 'b', port: 'height' }, to: { nodeId: 'blend', port: 'background' } }
      ],
      outputs: [{ channel: 'height', source: { nodeId: 'blend', port: 'height' } }],
      exposed: [],
      groups: [],
      subgraphs: []
    };
    expect(() => compileSurfaceGraph(graph)).toThrow(/more than one source/iu);

    graph.edges[1] = { from: { nodeId: 'b', port: 'height' }, to: { nodeId: 'blend', port: 'foreground' } };
    graph.outputs.push({ channel: 'height', source: { nodeId: 'a', port: 'height' } });
    expect(() => compileSurfaceGraph(graph)).toThrow(/output channel height more than once/iu);
  });

  it('rejects runtime dependency cycles even when authored edges are acyclic', () => {
    const graph = designerGraph();
    const brick = graph.nodes.find((node) => node.id === 'brick-tiles');
    const variation = graph.nodes.find((node) => node.id === 'variation');
    if (brick?.runtime === undefined || variation?.runtime === undefined) {
      throw new Error('Designer graph runtime nodes are missing.');
    }
    brick.runtime.structureFrom = 'variation';
    variation.runtime.structureFrom = 'brick-tiles';

    expect(() => compileSurfaceGraph(graph)).toThrow(/cyclic runtime material graph/iu);
  });

  it('rejects cyclic group parents and invalid exposed defaults', () => {
    const graph = designerGraph() as unknown as Record<string, unknown>;
    graph.groups = [
      { id: 'a', name: 'A', parentId: 'b', enabled: true, opacity: 1 },
      { id: 'b', name: 'B', parentId: 'a', enabled: true, opacity: 1 }
    ];
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/parent cycle/iu);

    graph.groups = [];
    const exposed = graph.exposed as Array<Record<string, unknown>>;
    if (exposed[0] === undefined) throw new Error('Designer graph has no exposed parameter.');
    exposed[0].defaultValue = 1_000_000;
    expect(() => normalizeSurfaceGraph(graph)).toThrow(/default/iu);
  });

  it('persists a preset graph but invalidates it after direct layer editing', () => {
    const state = new AppState(createDefaultProject());
    const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    if (preset === undefined) throw new Error('Brick designer preset is missing.');
    state.applyPreset(preset);
    expect(state.snapshot.surfaceGraph?.id).toBe('designer-old-brick-wall');

    const layer = state.snapshot.layers.find((item) => item.kind === 'pattern');
    if (layer === undefined) throw new Error('Brick designer preset has no pattern layer.');
    state.updateLayer(layer.id, { scale: layer.scale + 0.1 });
    expect(state.snapshot.surfaceGraph).toBeNull();
  });
});
