import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import type { SurfaceGraphDefinition } from '../src/core/graph/SurfaceGraph';
import {
  setSurfaceGraphExposedValue,
  surfaceGraphExposedValue
} from '../src/core/graph/SurfaceGraphParameters';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';
import { SURFACE_DESIGNER_PRESETS } from '../src/materials/surfaceDesignerPresets';

function preset(id: string) {
  const result = SURFACE_DESIGNER_PRESETS.find((item) => item.id === id);
  if (result === undefined || result.graph === undefined) throw new Error(`Missing test preset ${id}.`);
  return result;
}

function controlGraph(): SurfaceGraphDefinition {
  return {
    version: 1,
    id: 'control-graph',
    name: 'Control graph',
    nodes: [{
      id: 'pattern',
      kind: 'tile-sampler',
      label: 'Pattern',
      position: { x: 0, y: 0 },
      params: { kind: 'brick', maskInvert: false, channel: 'surface' },
      runtime: {
        kind: 'pattern',
        channel: 'surface',
        blendMode: 'normal',
        maskInvert: false,
        pattern: { kind: 'brick', aspect: 2 }
      }
    }],
    edges: [],
    outputs: [{ channel: 'height', source: { nodeId: 'pattern', port: 'height' } }],
    exposed: [
      { id: 'invert', label: 'Invert', nodeId: 'pattern', parameter: 'maskInvert', type: 'boolean', defaultValue: false },
      { id: 'pattern-kind', label: 'Pattern kind', nodeId: 'pattern', parameter: 'kind', type: 'enum', defaultValue: 'brick', options: ['brick', 'tile'] },
      { id: 'channel', label: 'Channel', nodeId: 'pattern', parameter: 'channel', type: 'enum', defaultValue: 'surface', options: ['surface', 'color'] }
    ],
    groups: [],
    subgraphs: []
  };
}

describe('surface graph exposed parameters', () => {
  it('updates node parameters and runtime pattern bindings', () => {
    const brick = preset('designer-old-brick-wall');
    const updated = setSurfaceGraphExposedValue(brick.graph!, 'mortar-gap', 0.14);
    const node = updated.nodes.find((item) => item.id === 'brick-tiles');

    expect(surfaceGraphExposedValue(updated, 'mortar-gap')).toBe(0.14);
    expect(node?.params.gap).toBe(0.14);
    expect(node?.runtime?.pattern?.gap).toBe(0.14);
  });

  it('updates boolean and enum runtime bindings', () => {
    const inverted = setSurfaceGraphExposedValue(controlGraph(), 'invert', true);
    expect(inverted.nodes[0]?.runtime?.maskInvert).toBe(true);

    const tiled = setSurfaceGraphExposedValue(inverted, 'pattern-kind', 'tile');
    expect(tiled.nodes[0]?.runtime?.pattern?.kind).toBe('tile');

    const colored = setSurfaceGraphExposedValue(tiled, 'channel', 'color');
    expect(colored.nodes[0]?.runtime?.channel).toBe('color');
  });

  it('applies graph presets with canonical compiled layer ids', () => {
    const brick = preset('designer-old-brick-wall');
    const expectedIds = compileSurfaceGraph(brick.graph!).layers.map((layer) => layer.id);
    const state = new AppState();

    state.applyPreset(brick);

    expect(state.snapshot.layers.map((layer) => layer.id)).toEqual(expectedIds);
  });

  it('recompiles graph-backed state without detaching the graph or changing selection', () => {
    const state = new AppState();
    state.applyPreset(preset('designer-dense-grass'));
    const splatter = state.snapshot.layers.find((layer) => layer.name === 'Blade Splatter');
    if (splatter === undefined) throw new Error('Grass preset is missing Blade Splatter.');
    state.selectLayer(splatter.id);

    state.setSurfaceGraphParameter('density', 2.2);

    expect(state.snapshot.surfaceGraph?.id).toBe('designer-dense-grass');
    expect(surfaceGraphExposedValue(state.snapshot.surfaceGraph!, 'density')).toBe(2.2);
    expect(state.snapshot.selectedLayerId).toBe(splatter.id);
    expect(state.snapshot.layers.find((layer) => layer.id === splatter.id)?.pattern?.density).toBe(2.2);
  });

  it('does not emit, add history, or rewrite authored runtime for an unchanged exposed value', () => {
    const state = new AppState();
    state.applyPreset(preset('designer-old-brick-wall'));
    const before = structuredClone(state.snapshot.surfaceGraph);
    let emissions = 0;
    state.subscribe(() => { emissions += 1; });

    state.setSurfaceGraphParameter('damage', 0.35);

    expect(emissions).toBe(0);
    expect(state.snapshot.surfaceGraph).toEqual(before);
    expect(state.undo()).toBe(true);
    expect(state.snapshot.surfaceGraph).toBeNull();
  });

  it('rejects values outside exposed ranges', () => {
    const brick = preset('designer-old-brick-wall');
    expect(() => setSurfaceGraphExposedValue(brick.graph!, 'mortar-gap', 1)).toThrow(/Mortar Width/u);
  });
});
