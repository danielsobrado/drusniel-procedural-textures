import { BIOLOGICAL_PRESETS } from './biologicalPresets';
import { CORE_MATERIAL_PRESETS } from './corePresets';
import { GRASS_EXTENSION_PRESETS } from './grassExtensionPresets';
import { GRASS_PRESETS } from './grassPresets';
import { applyHybridPresetEnhancements } from './hybridPresetEnhancements';
import { ICE_PRESETS } from './icePresets';
import { MOSS_EXTENSION_PRESETS } from './mossExtensionPresets';
import { MOSS_PRESETS } from './mossPresets';
import { placePresetLayerBefore } from './PresetLayerOrder';
import { STONE_PRESETS } from './stonePresets';
import { SURFACE_DESIGNER_CATALOG } from './surfaceDesignerCatalog';
import { SYNTHESIS_PRESETS } from './synthesisPresets';
import { TERRAIN_EXTENSION_PRESETS } from './terrainExtensionPresets';
import { TERRAIN_PRESETS } from './terrainPresets';
import { TEXTURE_FIELD_PRESETS } from './textureFieldPresets';
import type { MaterialPreset } from './types';

const MOSSY_STONE_SOURCE = 'preset-mossy-stone-meso';
const MOSSY_STONE_CONSUMER = 'preset-mossy-stone-colonies';

function hybridize(presets: readonly MaterialPreset[]): MaterialPreset[] {
  return presets.map((preset) => {
    const enhanced = applyHybridPresetEnhancements(preset);
    return preset.id === 'mossy-stone'
      ? placePresetLayerBefore(enhanced, MOSSY_STONE_SOURCE, MOSSY_STONE_CONSUMER)
      : enhanced;
  });
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  ...SURFACE_DESIGNER_CATALOG,
  ...TEXTURE_FIELD_PRESETS,
  ...SYNTHESIS_PRESETS,
  ...CORE_MATERIAL_PRESETS,
  ...hybridize(BIOLOGICAL_PRESETS),
  ...hybridize(ICE_PRESETS),
  ...STONE_PRESETS,
  ...hybridize(MOSS_PRESETS),
  ...hybridize(MOSS_EXTENSION_PRESETS),
  ...hybridize(TERRAIN_PRESETS),
  ...hybridize(TERRAIN_EXTENSION_PRESETS),
  ...hybridize(GRASS_PRESETS),
  ...hybridize(GRASS_EXTENSION_PRESETS)
];
