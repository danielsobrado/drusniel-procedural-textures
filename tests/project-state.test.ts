import { describe, expect, it } from 'vitest';
import { AppState, createDefaultLayer, createDefaultProject } from '../src/app/AppState';
import { normalizeProject } from '../src/app/ProjectFile';

describe('project normalization', () => {
  it('migrates version 1 projects to version 2 defaults', () => {
    const current = createDefaultProject();
    const legacy = {
      version: 1,
      selectedObject: current.selectedObject,
      selectedLayerId: current.selectedLayerId,
      background: current.background,
      wireframe: current.wireframe,
      layers: current.layers
    };
    const normalized = normalizeProject(legacy);
    expect(normalized.version).toBe(2);
    expect(normalized.groups).toEqual([]);
    expect(normalized.importedAssetName).toBeNull();
    expect(normalized.physical.roughness).toBeGreaterThan(0);
  });

  it('rejects cyclic group hierarchies', () => {
    const project = createDefaultProject();
    project.groups = [
      { id: 'group-a', name: 'A', parentId: 'group-b', enabled: true, opacity: 1 },
      { id: 'group-b', name: 'B', parentId: 'group-a', enabled: true, opacity: 1 }
    ];
    expect(() => normalizeProject(project)).toThrow(/cyclic group hierarchy/i);
  });

  it('rejects self-referencing masks', () => {
    const project = createDefaultProject();
    project.layers[0] = { ...project.layers[0]!, maskSourceLayerId: project.layers[0]!.id };
    expect(() => normalizeProject(project)).toThrow(/cannot mask itself/i);
  });

  it('requires restoration metadata when a project selects a custom HDR environment', () => {
    const project = createDefaultProject();
    project.environment = 'custom';
    project.environmentAssetName = null;
    expect(() => normalizeProject(project)).toThrow(/custom environment.*hdr asset name/i);

    project.environmentAssetName = 'studio.hdr';
    expect(normalizeProject(project).environmentAssetName).toBe('studio.hdr');
  });
});

describe('app state history', () => {
  it('coalesces repeated continuous edits into one undo step', () => {
    const state = new AppState(createDefaultProject());
    const id = state.snapshot.layers[0]!.id;
    const initial = state.snapshot.layers[0]!.opacity;
    state.updateLayer(id, { opacity: 0.72 });
    state.updateLayer(id, { opacity: 0.61 });
    expect(state.snapshot.layers[0]!.opacity).toBe(0.61);
    expect(state.undo()).toBe(true);
    expect(state.snapshot.layers[0]!.opacity).toBe(initial);
  });

  it('undoes and redoes discrete layer additions', () => {
    const state = new AppState(createDefaultProject());
    const before = state.snapshot.layers.length;
    state.addLayer(createDefaultLayer('spots').kind);
    expect(state.snapshot.layers).toHaveLength(before + 1);
    expect(state.undo()).toBe(true);
    expect(state.snapshot.layers).toHaveLength(before);
    expect(state.redo()).toBe(true);
    expect(state.snapshot.layers).toHaveLength(before + 1);
  });
});
