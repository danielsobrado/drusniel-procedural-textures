import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import {
  MATERIAL_PRESET_FILE_FORMAT,
  MATERIAL_PRESET_FILE_VERSION,
  parseMaterialPresetFile,
  serializeMaterialPresetFile
} from '../src/app/MaterialPresetFile';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';

describe('material preset files', () => {
  it('round-trips the authored material without project-only state', () => {
    const project = createDefaultProject();
    project.physical.roughness = 0.42;
    project.synthesis.weathering = 0.73;
    project.layers[1]!.scale = 7.5;

    const serialized = serializeMaterialPresetFile(project, 'Shared Moss');
    const document = JSON.parse(serialized) as {
      format: string;
      version: number;
      material: unknown;
    };
    const preset = parseMaterialPresetFile(document);

    expect(document.format).toBe(MATERIAL_PRESET_FILE_FORMAT);
    expect(document.version).toBe(MATERIAL_PRESET_FILE_VERSION);
    expect(preset.name).toBe('Shared Moss');
    expect(preset.physical).toEqual(project.physical);
    expect(preset.synthesis).toEqual(project.synthesis);
    expect(preset.groups).toEqual(project.groups);
    expect(preset.layers).toEqual(project.layers);
  });

  it('preserves graph-backed designer presets', () => {
    const source = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    if (source === undefined) throw new Error('Brick designer preset is missing.');
    const state = new AppState();
    state.applyPreset(source);

    const preset = parseMaterialPresetFile(JSON.parse(
      serializeMaterialPresetFile(state.snapshot, 'Portable Brick')
    ) as unknown);

    expect(preset.graph?.id).toBe('designer-old-brick-wall');
    expect(preset.layers.some((layer) => layer.kind === 'pattern')).toBe(true);
    expect(preset.groups).toEqual(state.snapshot.groups);
  });

  it('rebuilds graph-backed presets instead of trusting stale generated layers', () => {
    const source = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    if (source === undefined) throw new Error('Brick designer preset is missing.');
    const state = new AppState();
    state.applyPreset(source);
    const document = JSON.parse(
      serializeMaterialPresetFile(state.snapshot, 'Portable Brick')
    ) as { material: { layers: Array<Record<string, unknown>> } };
    document.material.layers = [{ id: 'stale', kind: 'removed-generator' }];

    const preset = parseMaterialPresetFile(document);
    expect(preset.graph?.id).toBe('designer-old-brick-wall');
    expect(preset.layers.some((layer) => layer.kind === 'pattern')).toBe(true);
  });

  it('applies a loaded preset through normal runtime validation', () => {
    const project = createDefaultProject();
    const preset = parseMaterialPresetFile(JSON.parse(
      serializeMaterialPresetFile(project, 'Portable Material')
    ) as unknown);
    const state = new AppState();

    expect(() => state.applyPreset(preset)).not.toThrow();
    expect(state.snapshot.layers).toHaveLength(project.layers.length);
    expect(state.snapshot.physical).toEqual(project.physical);
    expect(state.snapshot.synthesis).toEqual(project.synthesis);
  });

  it('loads legacy version-one preset files that omit synthesis and graphs', () => {
    const project = createDefaultProject();
    const document = JSON.parse(
      serializeMaterialPresetFile(project, 'Legacy Compatible')
    ) as { material: Record<string, unknown> };
    delete document.material.synthesis;
    delete document.material.graph;

    const preset = parseMaterialPresetFile(document);
    expect(preset.synthesis).toEqual(createDefaultProject().synthesis);
    expect(preset.graph).toBeUndefined();
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseMaterialPresetFile({
      format: 'other-format',
      version: MATERIAL_PRESET_FILE_VERSION,
      name: 'Wrong',
      material: {}
    })).toThrow(/not a Procedural Texture Lab material preset/u);
  });

  it('rejects layer controls outside configured runtime ranges', () => {
    const document = JSON.parse(
      serializeMaterialPresetFile(createDefaultProject(), 'Invalid Scale')
    ) as { material: { layers: Array<{ scale: number }> } };
    document.material.layers[0]!.scale = 1000;

    expect(() => parseMaterialPresetFile(document)).toThrow(/scale must be between/u);
  });
});
