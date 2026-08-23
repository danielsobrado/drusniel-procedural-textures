import { SURFACE_DESIGNER_PRESETS } from './surfaceDesignerPresets';
import type { MaterialPreset } from './types';

const PHYSICAL_ROUGHNESS_OVERRIDES: Readonly<Record<string, number>> = {
  'designer-road-asphalt': 0.68
};

export const SURFACE_DESIGNER_CATALOG: readonly MaterialPreset[] = SURFACE_DESIGNER_PRESETS.map((preset) => {
  const roughness = PHYSICAL_ROUGHNESS_OVERRIDES[preset.id];
  if (roughness === undefined) return preset;
  // Spreading `preset` here would read its lazy getters and compile the graph during
  // boot, which is exactly what the laziness exists to avoid - so delegate instead.
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    tags: preset.tags,
    synthesis: preset.synthesis,
    physical: { ...preset.physical, roughness },
    get groups() { return preset.groups; },
    get layers() { return preset.layers; },
    get graph() { return preset.graph; }
  };
});
