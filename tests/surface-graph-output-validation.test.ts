import { describe, expect, it } from 'vitest';
import type { SurfaceGraphDefinition, SurfaceGraphNode } from '../src/core/graph/SurfaceGraph';
import { setSurfaceGraphOutput } from '../src/core/graph/SurfaceGraphMutation';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';

function noise(id: string, x = 0): SurfaceGraphNode {
  return {
    id,
    kind: 'noise',
    label: id,
    position: { x, y: 0 },
    params: { scale: 4 },
    runtime: { kind: 'fbm', channel: 'height' }
  };
}

function output(id = 'output'): SurfaceGraphNode {
  return {
    id,
    kind: 'output',
    label: 'Material Output',
    position: { x: 500, y: 0 },
    params: {}
  };
}

function graph(nodes: SurfaceGraphNode[]): SurfaceGraphDefinition {
  return {
    version: 1,
    id: 'output-contract-test',
    name: 'Output contract test',
    nodes,
    edges: [],
    outputs: [{ channel: 'height', source: { nodeId: 'source-a', port: 'height' } }],
    exposed: [],
    groups: [],
    subgraphs: []
  };
}

describe('surface graph output contracts', () => {
  it('accepts compatible scalar routing and grayscale color output', () => {
    const source = noise('source-a');
    const roughness = graph([source]);
    roughness.outputs = [{ channel: 'roughness', source: { nodeId: source.id, port: 'height' } }];
    expect(() => compileSurfaceGraph(roughness)).not.toThrow();

    const color = graph([source]);
    color.outputs = [{ channel: 'baseColor', source: { nodeId: source.id, port: 'height' } }];
    expect(() => compileSurfaceGraph(color)).not.toThrow();
  });

  it('uses the same scalar-to-color rule through the graph mutation API', () => {
    const source = noise('source-a');
    const candidate = setSurfaceGraphOutput(
      graph([source]),
      'baseColor',
      { nodeId: source.id, port: 'height' }
    );

    expect(candidate.outputs.find((item) => item.channel === 'baseColor')?.source).toEqual({
      nodeId: source.id,
      port: 'height'
    });
    expect(() => compileSurfaceGraph(candidate)).not.toThrow();
  });

  it('rejects incompatible output types through the graph mutation API', () => {
    const normal: SurfaceGraphNode = {
      id: 'source-a',
      kind: 'height-to-normal',
      label: 'Normal',
      position: { x: 0, y: 0 },
      params: {}
    };

    expect(() => setSurfaceGraphOutput(
      graph([normal]),
      'baseColor',
      { nodeId: normal.id, port: 'normal' }
    )).toThrow(/cannot route normal to material output baseColor/iu);
  });

  it('accepts legacy semantic aliases only on explicit runtime-bound nodes', () => {
    const source = noise('source-a');
    source.runtime = { kind: 'fbm', channel: 'color', colorA: '#202830', colorB: '#b0bac4' };
    const candidate = graph([source]);
    candidate.outputs = [{ channel: 'baseColor', source: { nodeId: source.id, port: 'color' } }];

    expect(() => compileSurfaceGraph(candidate)).not.toThrow();
  });

  it('rejects output references to unknown source ports', () => {
    const candidate = graph([noise('source-a')]);
    candidate.outputs = [{ channel: 'height', source: { nodeId: 'source-a', port: 'missing' } }];

    expect(() => compileSurfaceGraph(candidate)).toThrow(/missing output port source-a\.missing/iu);
  });

  it('rejects incompatible PBR output types', () => {
    const source: SurfaceGraphNode = {
      id: 'source-a',
      kind: 'height-to-normal',
      label: 'Normal',
      position: { x: 0, y: 0 },
      params: {}
    };
    const candidate = graph([source]);
    candidate.outputs = [{ channel: 'baseColor', source: { nodeId: source.id, port: 'normal' } }];

    expect(() => compileSurfaceGraph(candidate)).toThrow(/expected color/iu);
  });

  it('rejects more than one material output node', () => {
    const candidate = graph([noise('source-a'), output('output-a'), output('output-b')]);

    expect(() => compileSurfaceGraph(candidate)).toThrow(/at most one material output node/iu);
  });

  it('rejects explicit output wires that disagree with portable outputs', () => {
    const candidate = graph([noise('source-a'), noise('source-b', 180), output()]);
    candidate.edges = [{
      from: { nodeId: 'source-a', port: 'height' },
      to: { nodeId: 'output', port: 'height' }
    }];
    candidate.outputs = [{ channel: 'height', source: { nodeId: 'source-b', port: 'height' } }];

    expect(() => compileSurfaceGraph(candidate)).toThrow(/disagrees with graph outputs/iu);
  });

  it('validates reusable subgraph output sources recursively', () => {
    const candidate = graph([noise('source-a')]);
    const nested = graph([noise('source-a')]);
    nested.id = 'nested';
    nested.name = 'Nested';
    nested.outputs = [{ channel: 'height', source: { nodeId: 'source-a', port: 'missing' } }];
    candidate.subgraphs = [nested];

    expect(() => compileSurfaceGraph(candidate)).toThrow(/missing output port source-a\.missing/iu);
  });
});
