import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import {
  addSurfaceGraphNode,
  connectSurfaceGraphPorts,
  exposeSurfaceGraphNodeParameter,
  removeSurfaceGraphNode,
  setSurfaceGraphNodeParameter,
  setSurfaceGraphNodePosition,
  setSurfaceGraphOutput
} from '../src/core/graph/SurfaceGraphMutation';
import { compileSurfaceGraph } from '../src/materials/SurfaceGraphCompiler';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';
import { createSurfaceGraphNode } from '../src/ui/surfaceGraph/GraphNodeFactory';

function designerPreset() {
  const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.graph !== undefined);
  if (preset?.graph === undefined) throw new Error('Surface Designer test preset is missing.');
  return preset;
}

describe('surface graph mutations', () => {
  it('moves nodes without changing compiled material behavior', () => {
    const graph = structuredClone(designerPreset().graph!);
    const node = graph.nodes[0];
    if (node === undefined) throw new Error('Surface Designer test graph has no nodes.');
    const before = compileSurfaceGraph(graph).layers;
    const moved = setSurfaceGraphNodePosition(graph, node.id, { x: node.position.x + 120, y: node.position.y - 45 });

    expect(moved.nodes.find((item) => item.id === node.id)?.position).toEqual({
      x: node.position.x + 120,
      y: node.position.y - 45
    });
    expect(compileSurfaceGraph(moved).layers).toEqual(before);
  });

  it('keeps explicit runtime pattern bindings synchronized with graph parameter edits', () => {
    const graph = structuredClone(designerPreset().graph!);
    const runtimeNode = graph.nodes.find((node) =>
      node.kind === 'tile-sampler' && node.runtime?.pattern !== undefined && typeof node.params.gap === 'number'
    );
    if (runtimeNode === undefined) throw new Error('Surface Designer test graph has no editable runtime pattern node.');

    const updated = setSurfaceGraphNodeParameter(graph, runtimeNode.id, 'gap', 0.11);
    const node = updated.nodes.find((item) => item.id === runtimeNode.id);
    expect(node?.params.gap).toBe(0.11);
    expect(node?.runtime?.pattern?.gap).toBe(0.11);
    expect(compileSurfaceGraph(updated).layers.find((layer) => layer.name === runtimeNode.label)?.pattern?.gap).toBe(0.11);
  });

  it('adds catalog nodes and rejects incompatible typed connections', () => {
    const graph = structuredClone(designerPreset().graph!);
    const color = createSurfaceGraphNode(graph, 'gradient-map', { x: 120, y: 480 });
    const levels = createSurfaceGraphNode(graph, 'levels', { x: 420, y: 480 });
    let updated = addSurfaceGraphNode(graph, color);
    updated = addSurfaceGraphNode(updated, levels);

    expect(updated.nodes.some((node) => node.id === color.id)).toBe(true);
    expect(() => connectSurfaceGraphPorts(
      updated,
      { nodeId: color.id, port: 'color' },
      { nodeId: levels.id, port: 'height' }
    )).toThrow(/cannot connect color to height/iu);
  });

  it('replaces driven inputs and updates portable PBR outputs', () => {
    const graph = structuredClone(designerPreset().graph!);
    const first = createSurfaceGraphNode(graph, 'noise', { x: 100, y: 520 });
    const second = createSurfaceGraphNode(graph, 'noise', { x: 100, y: 650 });
    const levels = createSurfaceGraphNode(graph, 'levels', { x: 380, y: 580 });
    let updated = addSurfaceGraphNode(graph, first);
    updated = addSurfaceGraphNode(updated, second);
    updated = addSurfaceGraphNode(updated, levels);
    updated = connectSurfaceGraphPorts(updated, { nodeId: first.id, port: 'height' }, { nodeId: levels.id, port: 'height' });
    updated = connectSurfaceGraphPorts(updated, { nodeId: second.id, port: 'height' }, { nodeId: levels.id, port: 'height' });
    updated = setSurfaceGraphOutput(updated, 'height', { nodeId: levels.id, port: 'height' });

    const driven = updated.edges.filter((edge) => edge.to.nodeId === levels.id && edge.to.port === 'height');
    expect(driven).toHaveLength(1);
    expect(driven[0]?.from.nodeId).toBe(second.id);
    expect(updated.outputs.find((output) => output.channel === 'height')?.source).toEqual({ nodeId: levels.id, port: 'height' });
    expect(() => compileSurfaceGraph(updated)).not.toThrow();
  });

  it('cleans routes and exposed controls when deleting a node', () => {
    const graph = structuredClone(designerPreset().graph!);
    const noise = createSurfaceGraphNode(graph, 'noise', { x: 100, y: 520 });
    noise.params.strength = 0.5;
    const levels = createSurfaceGraphNode(graph, 'levels', { x: 380, y: 520 });
    let updated = addSurfaceGraphNode(graph, noise);
    updated = addSurfaceGraphNode(updated, levels);
    updated = connectSurfaceGraphPorts(updated, { nodeId: noise.id, port: 'height' }, { nodeId: levels.id, port: 'height' });
    updated = exposeSurfaceGraphNodeParameter(updated, noise.id, 'strength', 'test-strength', 'Test strength');
    updated = removeSurfaceGraphNode(updated, noise.id);

    expect(updated.nodes.some((node) => node.id === noise.id)).toBe(false);
    expect(updated.edges.some((edge) => edge.from.nodeId === noise.id || edge.to.nodeId === noise.id)).toBe(false);
    expect(updated.exposed.some((item) => item.nodeId === noise.id)).toBe(false);
  });

  it('clears legacy runtime field links when deleting their source node', () => {
    const graph = structuredClone(designerPreset().graph!);
    const runtimeNodes = graph.nodes.filter((node) => node.runtime !== undefined);
    const source = runtimeNodes[0];
    const target = runtimeNodes[1];
    if (source === undefined || target?.runtime === undefined) {
      throw new Error('Surface Designer test graph needs two runtime nodes.');
    }
    target.runtime.structureFrom = source.id;
    target.runtime.maskFrom = source.id;

    const updated = removeSurfaceGraphNode(graph, source.id);
    const updatedTarget = updated.nodes.find((node) => node.id === target.id);

    expect(updatedTarget?.runtime?.structureFrom).toBeNull();
    expect(updatedTarget?.runtime?.maskFrom).toBeNull();
  });

  it('integrates graph edits with AppState undo and recompilation', () => {
    const state = new AppState(createDefaultProject());
    const preset = designerPreset();
    state.applyPreset(preset);
    const graph = state.snapshot.surfaceGraph;
    const node = graph?.nodes[0];
    if (graph === null || graph === undefined || node === undefined) throw new Error('Surface graph was not applied.');
    const original = { ...node.position };
    const moved = setSurfaceGraphNodePosition(graph, node.id, { x: original.x + 90, y: original.y + 30 });

    state.setSurfaceGraph(moved, `surface-graph:position:${node.id}`);
    expect(state.snapshot.surfaceGraph?.nodes.find((item) => item.id === node.id)?.position).not.toEqual(original);
    expect(state.undo()).toBe(true);
    expect(state.snapshot.surfaceGraph?.nodes.find((item) => item.id === node.id)?.position).toEqual(original);
  });
});
