import { describe, expect, it } from 'vitest';
import type { SurfaceGraphDefinition, SurfaceGraphExposedParameter } from '../src/core/graph/SurfaceGraph';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';

function graph(exposed: SurfaceGraphExposedParameter[]): SurfaceGraphDefinition {
  return {
    version: 1,
    id: 'exposed-contract-test',
    name: 'Exposed contract test',
    nodes: [{
      id: 'source',
      kind: 'noise',
      label: 'Source',
      position: { x: 0, y: 0 },
      params: { scale: 4, enabled: true, tint: '#334455', mode: 'soft' },
      runtime: { kind: 'fbm', channel: 'height', scale: 4 }
    }],
    edges: [],
    outputs: [{ channel: 'height', source: { nodeId: 'source', port: 'height' } }],
    exposed,
    groups: [],
    subgraphs: []
  };
}

const scale: SurfaceGraphExposedParameter = {
  id: 'scale',
  label: 'Scale',
  nodeId: 'source',
  parameter: 'scale',
  type: 'float',
  defaultValue: 4,
  min: 0.1,
  max: 20,
  step: 0.1
};

describe('Surface Graph exposed controls', () => {
  it('accepts controls that match their current node parameter', () => {
    const candidate = graph([
      scale,
      { id: 'enabled', label: 'Enabled', nodeId: 'source', parameter: 'enabled', type: 'boolean', defaultValue: true },
      { id: 'tint', label: 'Tint', nodeId: 'source', parameter: 'tint', type: 'color', defaultValue: '#334455' },
      {
        id: 'mode',
        label: 'Mode',
        nodeId: 'source',
        parameter: 'mode',
        type: 'enum',
        defaultValue: 'soft',
        options: ['soft', 'hard']
      }
    ]);

    expect(() => compileSurfaceGraph(candidate)).not.toThrow();
  });

  it('rejects bindings to missing node parameters', () => {
    const candidate = graph([{ ...scale, parameter: 'missing' }]);
    expect(() => compileSurfaceGraph(candidate)).toThrow(/references missing parameter source\.missing/iu);
  });

  it('rejects bindings whose declared type disagrees with the node parameter', () => {
    const candidate = graph([{
      id: 'wrong',
      label: 'Wrong',
      nodeId: 'source',
      parameter: 'enabled',
      type: 'float',
      defaultValue: 1
    }]);
    expect(() => compileSurfaceGraph(candidate)).toThrow(/numeric node parameter/iu);
  });

  it('rejects current values outside the exposed range', () => {
    const candidate = graph([{ ...scale, max: 2, defaultValue: 2 }]);
    expect(() => compileSurfaceGraph(candidate)).toThrow(/above its configured maximum/iu);
  });

  it('rejects duplicate controls for the same node parameter', () => {
    const candidate = graph([scale, { ...scale, id: 'scale-copy', label: 'Scale copy' }]);
    expect(() => compileSurfaceGraph(candidate)).toThrow(/exposed more than once/iu);
  });
});
