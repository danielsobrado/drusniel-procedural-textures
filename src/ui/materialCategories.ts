import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset } from '../materials/types';

export interface MaterialCategory {
  id: string;
  label: string;
  glyph: string;
  /** Tags that place a preset here. Matched in list order, so earlier wins. */
  tags: readonly string[];
}

/**
 * Curated rather than derived from `preset.tags` directly. There are 69 distinct tags across
 * the library, most on one or two presets, and the vocabulary is mixed with provenance
 * markers (`v0.2`, `v0.3`, `surface-designer`, `hybrid`). A ring needs a handful of stable,
 * meaningful slots, so the mapping is explicit.
 *
 * Order is priority: categories describe what a material *is*, so specific surface families
 * are matched before provenance. That puts "Designer - Dense Grass" under Grass where
 * someone looking for grass will find it, while "Designer - Old Brick Wall" falls through to
 * Built & designer.
 */
export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = [
  {
    id: 'grass',
    label: 'Grass & meadow',
    glyph: '❋',
    tags: ['grass', 'meadow', 'turf', 'lush', 'savanna']
  },
  {
    id: 'moss',
    label: 'Moss & lichen',
    glyph: '❖',
    tags: ['moss', 'lichen', 'bog', 'fungal', 'wetland']
  },
  {
    id: 'stone',
    label: 'Rock, stone & ice',
    glyph: '⬢',
    tags: [
      'stone', 'rock', 'mineral', 'marble', 'cobble', 'flagstone', 'limestone',
      'sandstone', 'gravel', 'crystal', 'ice', 'frost', 'cold', 'geological',
      'volcanic', 'lava', 'scree', 'mountain'
    ]
  },
  {
    id: 'soil',
    label: 'Soil, sand & mud',
    glyph: '▨',
    tags: ['soil', 'mud', 'clay', 'sand', 'beach', 'coastal', 'dirt', 'erosion', 'dune']
  },
  {
    id: 'built',
    label: 'Built & designer',
    glyph: '▦',
    tags: [
      'surface-designer', 'architectural', 'masonry', 'pavement', 'structure', 'roof',
      'brick', 'wood', 'fabric', 'asphalt', 'concrete', 'plaster', 'tiles', 'weathered'
    ]
  },
  {
    id: 'organic',
    label: 'Organic & tissue',
    glyph: '◐',
    tags: [
      'biological', 'tissue', 'adipose', 'skin', 'vascular', 'sss', 'cellular',
      'fascia', 'necrotic', 'fibrous', 'translucent', 'sci-fi'
    ]
  },
  {
    id: 'field',
    label: 'Texture fields',
    glyph: '⌗',
    tags: [
      'texture-field', 'hybrid', 'family', 'sdf', 'simulation', 'reaction-diffusion'
    ]
  }
];

/** Presets that match no category. Asserted empty by a test so nothing silently vanishes. */
export const UNCATEGORISED_LABEL = 'Other';

function matches(preset: Readonly<MaterialPreset>, category: MaterialCategory): boolean {
  return preset.tags.some((tag) => category.tags.includes(tag));
}

export function categoryOf(preset: Readonly<MaterialPreset>): MaterialCategory | null {
  return MATERIAL_CATEGORIES.find((category) => matches(preset, category)) ?? null;
}

const byCategory = new Map<string, MaterialPreset[]>();
for (const category of MATERIAL_CATEGORIES) byCategory.set(category.id, []);
const uncategorised: MaterialPreset[] = [];
for (const preset of [...MATERIAL_PRESETS].sort((a, b) => a.name.localeCompare(b.name))) {
  const category = categoryOf(preset);
  if (category === null) {
    uncategorised.push(preset);
    continue;
  }
  byCategory.get(category.id)?.push(preset);
}

export function presetsInCategory(categoryId: string): readonly MaterialPreset[] {
  return byCategory.get(categoryId) ?? [];
}

export function uncategorisedPresets(): readonly MaterialPreset[] {
  return uncategorised;
}

/** Free-text match over name, description and tags, mirroring the library panel's filter. */
export function searchPresets(query: string): readonly MaterialPreset[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return MATERIAL_PRESETS.filter((preset) => {
    const haystack = `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase();
    return haystack.includes(needle);
  });
}
