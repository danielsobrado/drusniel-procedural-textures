import { describe, expect, it } from 'vitest';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphNodeKind,
  SurfaceGraphValueType
} from '../src/core/graph/SurfaceGraph';
import { SURFACE_GRAPH_NODE_SPECS } from '../src/core/graph/SurfaceGraphCatalog';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';

const NON_EXECUTABLE = new Set<SurfaceGraphNodeKind>(['output']);

const OUTPUT_SPEC = SURFACE_GRAPH_NODE_SPECS.find((spec) => spec.kind === 'output')!;

const SCALAR_TYPES = new Set<SurfaceGraphValueType>(['float', 'mask', 'height']);
function compatible(source: SurfaceGraphValueType, target: SurfaceGraphValueType): boolean {
  return source === target || (SCALAR_TYPES.has(source) && SCALAR_TYPES.has(target));
}

interface Route {
  sourcePort: string;
  channel: string;
  via?: { kind: SurfaceGraphNodeKind; inPort: string; outPort: string };
}

function routeFor(kind: SurfaceGraphNodeKind): Route {
  const spec = SURFACE_GRAPH_NODE_SPECS.find((entry) => entry.kind === kind);
  if (spec === undefined) throw new Error(`No catalog spec for ${kind}.`);

  for (const out of spec.outputs) {
    const channel = OUTPUT_SPEC.inputs.find((input) => compatible(out.type, input.type));
    if (channel !== undefined) return { sourcePort: out.name, channel: channel.name };
  }

  for (const out of spec.outputs) {
    for (const candidate of SURFACE_GRAPH_NODE_SPECS) {
      if (candidate.kind === kind || candidate.kind === 'output') continue;
      const inPort = candidate.inputs.find((input) => compatible(out.type, input.type));
      if (inPort === undefined) continue;
      for (const adapterOut of candidate.outputs) {
        const channel = OUTPUT_SPEC.inputs.find((input) => compatible(adapterOut.type, input.type));
        if (channel === undefined) continue;
        return {
          sourcePort: out.name,
          channel: channel.name,
          via: { kind: candidate.kind, inPort: inPort.name, outPort: adapterOut.name }
        };
      }
    }
  }

  throw new Error(`${kind} cannot reach any material output channel.`);
}

function graphFor(kind: SurfaceGraphNodeKind): SurfaceGraphDefinition {
  const route = routeFor(kind);
  const terminalNode = route.via === undefined ? 'source' : 'adapter';
  const terminalPort = route.via === undefined ? route.sourcePort : route.via.outPort;

  return {
    version: 1,
    id: `test-${kind}`,
    name: `Test ${kind}`,
    nodes: [
      { id: 'source', kind, label: kind, position: { x: 0, y: 0 }, params: {} },
      ...(route.via === undefined
        ? []
        : [{
            id: 'adapter',
            kind: route.via.kind,
            label: route.via.kind,
            position: { x: 100, y: 0 },
            params: {}
          }]),
      { id: 'output', kind: 'output', label: 'Output', position: { x: 200, y: 0 }, params: {} }
    ],
    edges: [
      ...(route.via === undefined
        ? []
        : [{
            from: { nodeId: 'source', port: route.sourcePort },
            to: { nodeId: 'adapter', port: route.via.inPort }
          }]),
      { from: { nodeId: terminalNode, port: terminalPort }, to: { nodeId: 'output', port: route.channel } }
    ],
    outputs: [{ channel: route.channel, source: { nodeId: terminalNode, port: terminalPort } }],
    exposed: [],
    groups: [],
    subgraphs: kind === 'subgraph'
      ? [{
          version: 1,
          id: 'nested',
          name: 'Nested',
          nodes: [{
            id: 'noise',
            kind: 'noise',
            label: 'Noise',
            position: { x: 0, y: 0 },
            params: {}
          }],
          edges: [],
          outputs: [{ channel: 'height', source: { nodeId: 'noise', port: 'height' } }],
          exposed: [],
          groups: [],
          subgraphs: []
        }]
      : []
  };
}

describe('surface graph generic runtime lowering', () => {
  it.each(
    SURFACE_GRAPH_NODE_SPECS.map((spec) => spec.kind).filter((kind) => !NON_EXECUTABLE.has(kind))
  )('lowers %s into an executable PTL material layer', (kind) => {
    const graph = graphFor(kind);
    if (kind === 'subgraph') {
      graph.nodes[0]!.subgraphId = 'nested';
      graph.nodes[0]!.runtime = { kind: 'fbm', channel: 'roughness', opacity: 0.24, scale: 8.5, seed: 72 };
    }
    const compiled = compileSurfaceGraph(graph);
    expect(compiled.layers.length).toBeGreaterThan(0);
    expect(compiled.layers[0]?.name).toBe(kind);
  });

  it('routes connected generic nodes through shared structure', () => {
    const graph: SurfaceGraphDefinition = {
      version: 1,
      id: 'test-routing',
      name: 'Test routing',
      nodes: [
        { id: 'noise', kind: 'noise', label: 'Noise', position: { x: 0, y: 0 }, params: {} },
        { id: 'shaped', kind: 'sdf', label: 'SDF', position: { x: 160, y: 0 }, params: {} },
        { id: 'output', kind: 'output', label: 'Output', position: { x: 320, y: 0 }, params: {} }
      ],
      edges: [
        { from: { nodeId: 'noise', port: 'height' }, to: { nodeId: 'shaped', port: 'a' } },
        { from: { nodeId: 'shaped', port: 'height' }, to: { nodeId: 'output', port: 'height' } }
      ],
      outputs: [{ channel: 'height', source: { nodeId: 'shaped', port: 'height' } }],
      exposed: [],
      groups: [],
      subgraphs: []
    };
    const compiled = compileSurfaceGraph(graph);
    expect(compiled.layers).toHaveLength(2);
    expect(compiled.layers[1]?.structureSourceLayerId).toBe(compiled.layers[0]?.id);
  });

  it('keeps an unimplemented operator inert while preserving its upstream route', () => {
    const graph: SurfaceGraphDefinition = {
      version: 1,
      id: 'test-unimplemented',
      name: 'Test unimplemented',
      nodes: [
        { id: 'noise', kind: 'noise', label: 'Noise', position: { x: 0, y: 0 }, params: {} },
        { id: 'levels', kind: 'levels', label: 'Levels', position: { x: 160, y: 0 }, params: {} },
        { id: 'output', kind: 'output', label: 'Output', position: { x: 320, y: 0 }, params: {} }
      ],
      edges: [
        { from: { nodeId: 'noise', port: 'height' }, to: { nodeId: 'levels', port: 'height' } },
        { from: { nodeId: 'levels', port: 'height' }, to: { nodeId: 'output', port: 'height' } }
      ],
      outputs: [{ channel: 'height', source: { nodeId: 'levels', port: 'height' } }],
      exposed: [],
      groups: [],
      subgraphs: []
    };

    const compiled = compileSurfaceGraph(graph);
    expect(compiled.layers).toHaveLength(2);
    expect(compiled.layers[1]?.name).toBe('Levels');
    expect(compiled.layers[1]?.opacity).toBe(0);
    expect(compiled.layers[1]?.displacement).toBe(0);
    expect(compiled.layers[1]?.structureSourceLayerId).toBe(compiled.layers[0]?.id);
  });

  it('keeps downstream routing valid across an unimplemented operator', () => {
    const graph: SurfaceGraphDefinition = {
      version: 1,
      id: 'test-unimplemented-chain',
      name: 'Test unimplemented chain',
      nodes: [
        { id: 'noise', kind: 'noise', label: 'Noise', position: { x: 0, y: 0 }, params: {} },
        { id: 'levels', kind: 'levels', label: 'Levels', position: { x: 120, y: 0 }, params: {} },
        { id: 'sdf', kind: 'sdf', label: 'SDF', position: { x: 240, y: 0 }, params: {} },
        { id: 'output', kind: 'output', label: 'Output', position: { x: 360, y: 0 }, params: {} }
      ],
      edges: [
        { from: { nodeId: 'noise', port: 'height' }, to: { nodeId: 'levels', port: 'height' } },
        { from: { nodeId: 'levels', port: 'height' }, to: { nodeId: 'sdf', port: 'a' } },
        { from: { nodeId: 'sdf', port: 'height' }, to: { nodeId: 'output', port: 'height' } }
      ],
      outputs: [{ channel: 'height', source: { nodeId: 'sdf', port: 'height' } }],
      exposed: [],
      groups: [],
      subgraphs: []
    };

    const compiled = compileSurfaceGraph(graph);
    expect(compiled.layers).toHaveLength(3);
    expect(compiled.layers[1]?.opacity).toBe(0);
    expect(compiled.layers[1]?.structureSourceLayerId).toBe(compiled.layers[0]?.id);
    expect(compiled.layers[2]?.structureSourceLayerId).toBe(compiled.layers[1]?.id);
  });

  it('keeps a standalone unimplemented operator valid but inert', () => {
    const compiled = compileSurfaceGraph(graphFor('levels'));
    expect(compiled.layers.length).toBeGreaterThan(0);
    expect(compiled.layers[0]?.opacity).toBe(0);
  });
});
