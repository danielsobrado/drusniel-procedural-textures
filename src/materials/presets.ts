import { BIOLOGICAL_PRESETS } from './biologicalPresets';
import { CORE_MATERIAL_PRESETS } from './corePresets';
import { GRASS_EXTENSION_PRESETS } from './grassExtensionPresets';
import { GRASS_PRESETS } from './grassPresets';
import { ICE_PRESETS } from './icePresets';
import { MOSS_EXTENSION_PRESETS } from './mossExtensionPresets';
import { MOSS_PRESETS } from './mossPresets';
import { STONE_PRESETS } from './stonePresets';
import { SURFACE_DESIGNER_CATALOG } from './surfaceDesignerCatalog';
import { SYNTHESIS_PRESETS } from './synthesisPresets';
import { TERRAIN_EXTENSION_PRESETS } from './terrainExtensionPresets';
import { TERRAIN_PRESETS } from './terrainPresets';
import type { MaterialPreset } from './types';

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  ...SURFACE_DESIGNER_CATALOG,
  ...SYNTHESIS_PRESETS,
  ...CORE_MATERIAL_PRESETS,
  ...BIOLOGICAL_PRESETS,
  ...ICE_PRESETS,
  ...STONE_PRESETS,
  ...MOSS_PRESETS,
  ...MOSS_EXTENSION_PRESETS,
  ...TERRAIN_PRESETS,
  ...TERRAIN_EXTENSION_PRESETS,
  ...GRASS_PRESETS,
  ...GRASS_EXTENSION_PRESETS
];
