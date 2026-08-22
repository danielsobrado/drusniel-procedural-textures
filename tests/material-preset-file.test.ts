import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import {
  MATERIAL_PRESET_FILE_FORMAT,
  MATERIAL_PRESET_FILE_VERSION,
  parseMaterialPresetFile,
  serializeMaterialPresetFile
} from '../src/app/MaterialPresetFile';

describe('material preset files', () => {
  it('round-trips the authored material without project-only state', () => {
    const project = createDefaultProject();
    project.physical.roughness = 0.42;
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
    expect(preset.groups).toEqual(project.groups);
    expect(preset.layers).toEqual(project.layers);
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
