import { describe, expect, it } from 'vitest';
import type { SurfaceGraphDefinition, SurfaceGraphNode } from '../src/core/graph/SurfaceGraph';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';
import {
  createSurfaceGraphNode,
  graphNodeBrowserSpecs
} from '../src/ui/surfaceGraph/GraphNodeFactory';

function node(
  id: string,
  kind: SurfaceGraphNode['kind'],
  x: number,
  runtime?: SurfaceGraphNode['runtime']
): SurfaceGraphNode {
  return {
    id,
    kind,
    label: id,
    position: { x, y: 0 },
    params: {},
    runtime
  };
}

function graph(nodes: SurfaceGraphNode[]): SurfaceGraphDefinition {
  return {
    version: 1,
    id: 'runtime-routing',
    name: 'Runtime routing',
    nodes,
    edges: [],
    outputs: [],
    exposed: [],
    groups: [],
    subgraphs: []
  };
}

describe('Surface Graph runtime routing', () => {
  it('lets a formal wire override a legacy runtime structure dependency', () => {
    const legacy = node('legacy', 'noise', 0, { kind: 'fbm', channel: 'height' });
    const source = node('source', 'noise', 160);
    const target = node('target', 'levels', 340, {
      kind: 'fbm',
      channel: 'height',
      structureFrom: legacy.id
    });
    const candidate = graph([legacy, source, target]);
    candidate.edges = [{
      from: { nodeId: source.id, port: 'height' },
      to: { nodeId: target.id, port: 'height' }
    }];
    candidate.outputs = [{ channel: 'height', source: { nodeId: target.id, port: 'height' } }];

    const compiled = compileSurfaceGraph(candidate);
    const targetLayer = compiled.layers.find((layer) => layer.name === target.label);

    expect(compiled.layers.some((layer) => layer.name === source.label)).toBe(true);
    expect(targetLayer?.structureSourceLayerId).toBe(`${candidate.id}:${source.id}`);
    expect(targetLayer?.structureSourceLayerId).not.toBe(`${candidate.id}:${legacy.id}`);
  });

  it('maps both connected runtime inputs instead of silently dropping the second route', () => {
    const first = node('first', 'noise', 0);
    const second = node('second', 'noise', 0);
    const blend = node('blend', 'blend', 300);
    const candidate = graph([first, second, blend]);
    candidate.edges = [
      { from: { nodeId: first.id, port: 'height' }, to: { nodeId: blend.id, port: 'background' } },
      { from: { nodeId: second.id, port: 'height' }, to: { nodeId: blend.id, port: 'foreground' } }
    ];
    candidate.outputs = [{ channel: 'height', source: { nodeId: blend.id, port: 'height' } }];

    const compiled = compileSurfaceGraph(candidate);
    const blendLayer = compiled.layers.find((layer) => layer.name === blend.label);

    expect(blendLayer?.structureSourceLayerId).toBe(`${candidate.id}:${first.id}`);
    expect(blendLayer?.maskSourceLayerId).toBe(`${candidate.id}:${second.id}`);
  });

  it('rejects a third runtime input instead of accepting a route that cannot execute', () => {
    const first = node('first', 'noise', 0);
    const second = node('second', 'noise', 0);
    const third = node('third', 'noise', 0);
    const blend = node('blend', 'blend', 300);
    const candidate = graph([first, second, third, blend]);
    candidate.edges = [
      { from: { nodeId: first.id, port: 'height' }, to: { nodeId: blend.id, port: 'background' } },
      { from: { nodeId: second.id, port: 'height' }, to: { nodeId: blend.id, port: 'foreground' } },
      { from: { nodeId: third.id, port: 'height' }, to: { nodeId: blend.id, port: 'opacity' } }
    ];
    candidate.outputs = [{ channel: 'height', source: { nodeId: blend.id, port: 'height' } }];

    expect(() => compileSurfaceGraph(candidate)).toThrow(/supports at most 2/iu);
  });

  it('does not offer unbound nested subgraphs that the V0.3 runtime cannot execute', () => {
    const candidate = graph([node('source', 'noise', 0)]);
    expect(graphNodeBrowserSpecs(candidate).some((spec) => spec.kind === 'subgraph')).toBe(false);
    expect(() => createSurfaceGraphNode(candidate, 'subgraph', { x: 0, y: 0 })).toThrow(/not executable/iu);
  });
});
