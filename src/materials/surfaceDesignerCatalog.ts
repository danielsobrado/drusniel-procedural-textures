import { SURFACE_DESIGNER_PRESETS } from './surfaceDesignerPresets';
import type { MaterialPreset } from './types';

const PHYSICAL_ROUGHNESS_OVERRIDES: Readonly<Record<string, number>> = {
  'designer-road-asphalt': 0.68
};

export const SURFACE_DESIGNER_CATALOG: readonly MaterialPreset[] = SURFACE_DESIGNER_PRESETS.map((preset) => {
  const roughness = PHYSICAL_ROUGHNESS_OVERRIDES[preset.id];
  if (roughness === undefined) return preset;
  return {
    ...preset,
    physical: { ...preset.physical, roughness }
  };
});
