import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import rawQaConfig from '../config/qa.yaml?raw';
import { OBJECT_PRESETS } from '../src/app/constants';
import { MATERIAL_PRESETS } from '../src/materials/presets';

interface QaNaturalPreset {
  id: string;
  category: string;
  fileStem: string;
  previewObjectId: string;
}

interface QaConfig {
  tile: {
    channels: string[];
  };
  naturalPresets: QaNaturalPreset[];
}

const EXPECTED_TILE_CHANNELS = [
  'albedo',
  'roughness',
  'normal',
  'height',
  'clearcoat',
  'clearcoatRoughness'
] as const;

const qaConfig = parse(rawQaConfig) as QaConfig;

describe('QA capture configuration', () => {
  it('references existing material presets and preview objects', () => {
    const presetIds = new Set<string>(MATERIAL_PRESETS.map((preset) => preset.id));
    const objectIds = new Set<string>(OBJECT_PRESETS.map((preset) => preset.id));

    for (const preset of qaConfig.naturalPresets) {
      expect(presetIds.has(preset.id), preset.id).toBe(true);
      expect(objectIds.has(preset.previewObjectId), preset.previewObjectId).toBe(true);
    }
  });

  it('keeps natural preset capture ids and file stems unique', () => {
    const ids = qaConfig.naturalPresets.map((preset) => preset.id);
    const fileStems = qaConfig.naturalPresets.map((preset) => preset.fileStem);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(fileStems).size).toBe(fileStems.length);
  });

  it('covers all exported PBR channels for seam verification', () => {
    expect(new Set(qaConfig.tile.channels)).toEqual(new Set(EXPECTED_TILE_CHANNELS));
  });

  it('contains the moss, terrain, grass and biological QA categories', () => {
    const categories = new Set(qaConfig.naturalPresets.map((preset) => preset.category));
    expect(categories).toEqual(new Set(['moss', 'terrain', 'grass', 'biological']));
  });
});

