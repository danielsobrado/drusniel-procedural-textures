import { describe, expect, it } from 'vitest';
import type { SurfaceGraphDefinition, SurfaceGraphNodeKind } from '../src/core/graph/SurfaceGraph';
import { SURFACE_GRAPH_NODE_SPECS } from '../src/core/graph/SurfaceGraphCatalog';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';

const NON_EXECUTABLE = new Set<SurfaceGraphNodeKind>(['output']);

function graphFor(kind: SurfaceGraphNodeKind): SurfaceGraphDefinition {
  const sourcePort = SURFACE_GRAPH_NODE_SPECS.find((spec) => spec.kind === kind)?.outputs[0]?.name ?? 'height';
  return {
    version: 1,
    id: `test-${kind}`,
    name: `Test ${kind}`,
    nodes: [
      { id: 'source', kind, label: kind, position: { x: 0, y: 0 }, params: {} },
      { id: 'output', kind: 'output', label: 'Output', position: { x: 200, y: 0 }, params: {} }
    ],
    edges: [
      { from: { nodeId: 'source', port: sourcePort }, to: { nodeId: 'output', port: 'height' } }
    ],
    outputs: [{ channel: 'height', source: { nodeId: 'source', port: sourcePort } }],
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
    if (kind === 'subgraph') graph.nodes[0]!.subgraphId = 'nested';
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
    expect(compiled.layers[1]?.structureSourceLayerId).toBe(compiled.layers[0]?.id);
  });
});
