import { BIOLOGICAL_PRESETS } from './biologicalPresets';
import { CORE_MATERIAL_PRESETS } from './corePresets';
import { GRASS_EXTENSION_PRESETS } from './grassExtensionPresets';
import { GRASS_PRESETS } from './grassPresets';
import { MOSS_EXTENSION_PRESETS } from './mossExtensionPresets';
import { MOSS_PRESETS } from './mossPresets';
import { TERRAIN_EXTENSION_PRESETS } from './terrainExtensionPresets';
import { TERRAIN_PRESETS } from './terrainPresets';
import type { MaterialPreset } from './types';

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  ...CORE_MATERIAL_PRESETS,
  ...BIOLOGICAL_PRESETS,
  ...MOSS_PRESETS,
  ...MOSS_EXTENSION_PRESETS,
  ...TERRAIN_PRESETS,
  ...TERRAIN_EXTENSION_PRESETS,
  ...GRASS_PRESETS,
  ...GRASS_EXTENSION_PRESETS
];
