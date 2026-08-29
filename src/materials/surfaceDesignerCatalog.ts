import type { SurfaceGraphNode } from '../core/graph/SurfaceGraph';
import { DENSE_GRASS_SURFACE_PRESET } from './denseGrassSurfacePreset';
import { STRUCTURED_SURFACE_PRESETS } from './structuredSurfacePresets';
import { SURFACE_DESIGNER_PRESETS } from './surfaceDesignerPresets';
import type { MaterialPreset } from './types';

const BRICK_PROFILE_REFERENCE: SurfaceGraphNode = {
  id: 'brick-shape',
  kind: 'shape',
  label: 'Brick Profile',
  position: { x: 0, y: 100 },
  params: { shape: 'rounded-rectangle' }
};

function withBrickProfileReference(source: MaterialPreset): MaterialPreset {
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    tags: source.tags,
    physical: source.physical,
    synthesis: source.synthesis,
    get groups() { return source.groups; },
    get layers() { return source.layers; },
    get graph() {
      const graph = source.graph;
      if (graph === undefined || graph.nodes.some((item) => item.id === BRICK_PROFILE_REFERENCE.id)) return graph;
      return { ...graph, nodes: [BRICK_PROFILE_REFERENCE, ...graph.nodes] };
    }
  };
}

const STRUCTURED_OVERRIDES = Object.fromEntries(
  STRUCTURED_SURFACE_PRESETS.map((preset) => [
    preset.id,
    preset.id === 'designer-old-brick-wall' ? withBrickProfileReference(preset) : preset
  ])
) as Record<string, MaterialPreset>;

const PRESET_OVERRIDES: Readonly<Record<string, MaterialPreset>> = {
  'designer-dense-grass': DENSE_GRASS_SURFACE_PRESET,
  ...STRUCTURED_OVERRIDES
};

const OVERRIDDEN_IDS = new Set(SURFACE_DESIGNER_PRESETS.map((preset) => preset.id));

export const SURFACE_DESIGNER_CATALOG: readonly MaterialPreset[] = [
  ...SURFACE_DESIGNER_PRESETS.map((preset) => PRESET_OVERRIDES[preset.id] ?? preset),
  // Structured presets that refine an authored designer preset replace it above. Ones that
  // introduce a new material, rather than overriding an existing id, are appended so they
  // reach the library, the thumbnail generator and the recipe catalog.
  ...STRUCTURED_SURFACE_PRESETS.filter((preset) => !OVERRIDDEN_IDS.has(preset.id))
];
