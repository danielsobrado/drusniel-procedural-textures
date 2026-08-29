import { describe, expect, it } from 'vitest';
import { lowerSurfaceGraphRuntimeNodes } from '../src/core/graph/SurfaceGraphRuntimeLowering';
import type { SurfaceGraphDefinition, SurfaceGraphEdge } from '../src/core/graph/SurfaceGraph';

function graphWith(edges: SurfaceGraphEdge[], params = {}): SurfaceGraphDefinition {
  return {
    version: 1,
    id: 'height-blend-fixture',
    name: 'Height Blend Fixture',
    nodes: [
      { id: 'bricks', kind: 'tile-sampler', label: 'Bricks', position: { x: 0, y: 0 }, params: {} },
      { id: 'moss', kind: 'noise', label: 'Moss', position: { x: 100, y: 0 }, params: {} },
      { id: 'gate', kind: 'noise', label: 'Gate', position: { x: 100, y: 90 }, params: {} },
      { id: 'blend', kind: 'height-blend', label: 'Mossy', position: { x: 220, y: 0 }, params },
      { id: 'output', kind: 'output', label: 'PBR Output', position: { x: 360, y: 0 }, params: {} }
    ],
    edges,
    outputs: [{ channel: 'baseColor', source: { nodeId: 'blend', port: 'height' } }],
    exposed: [],
    groups: [],
    subgraphs: []
  };
}

const BASE_TO_BLEND: SurfaceGraphEdge = {
  from: { nodeId: 'bricks', port: 'height' },
  to: { nodeId: 'blend', port: 'base' }
};
const TOP_TO_BLEND: SurfaceGraphEdge = {
  from: { nodeId: 'moss', port: 'height' },
  to: { nodeId: 'blend', port: 'top' }
};

function blendRuntime(graph: SurfaceGraphDefinition) {
  return lowerSurfaceGraphRuntimeNodes(graph).find((node) => node.id === 'blend')?.runtime;
}

describe('height blend lowering', () => {
  it('lowers to an executable height-masked layer instead of plain noise', () => {
    const runtime = blendRuntime(graphWith([BASE_TO_BLEND, TOP_TO_BLEND]));
    expect(runtime).toBeDefined();
    expect(runtime?.maskMode).toBe('height');
  });

  it('binds top to the structure route and base to the mask route by port name', () => {
    const runtime = blendRuntime(graphWith([BASE_TO_BLEND, TOP_TO_BLEND]));
    expect(runtime?.structureFrom).toBe('moss');
    expect(runtime?.maskFrom).toBe('bricks');
  });

  it('binds by name regardless of the order the edges are declared in', () => {
    const forward = blendRuntime(graphWith([BASE_TO_BLEND, TOP_TO_BLEND]));
    const reversed = blendRuntime(graphWith([TOP_TO_BLEND, BASE_TO_BLEND]));
    expect(reversed?.structureFrom).toBe(forward?.structureFrom);
    expect(reversed?.maskFrom).toBe(forward?.maskFrom);
  });

  it('reads threshold, softness and breakup from node parameters', () => {
    const runtime = blendRuntime(graphWith([BASE_TO_BLEND, TOP_TO_BLEND], {
      threshold: 0.28,
      softness: 0.06,
      breakup: 0.35,
      invert: true
    }));
    expect(runtime?.maskThreshold).toBe(0.28);
    expect(runtime?.maskSoftness).toBe(0.06);
    expect(runtime?.maskBreakup).toBe(0.35);
    expect(runtime?.maskInvert).toBe(true);
  });

  it('defaults to placing the top input where the base relief is high', () => {
    expect(blendRuntime(graphWith([BASE_TO_BLEND, TOP_TO_BLEND]))?.maskInvert).toBe(false);
  });

  it('clamps out-of-range shaping parameters', () => {
    const runtime = blendRuntime(graphWith([BASE_TO_BLEND, TOP_TO_BLEND], {
      threshold: 4,
      softness: -1,
      breakup: 9
    }));
    expect(runtime?.maskThreshold).toBe(1);
    expect(runtime?.maskSoftness).toBe(0);
    expect(runtime?.maskBreakup).toBe(1);
  });

  it('rejects a driven opacity port with a message naming the single mask slot', () => {
    expect(() => blendRuntime(graphWith([
      BASE_TO_BLEND,
      TOP_TO_BLEND,
      { from: { nodeId: 'gate', port: 'height' }, to: { nodeId: 'blend', port: 'opacity' } }
    ]))).toThrow(/single mask slot/);
  });

  it('tolerates a partially wired node', () => {
    const runtime = blendRuntime(graphWith([TOP_TO_BLEND]));
    expect(runtime?.structureFrom).toBe('moss');
    expect(runtime?.maskFrom).toBeUndefined();
  });
});
