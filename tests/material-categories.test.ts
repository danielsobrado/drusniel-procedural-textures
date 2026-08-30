import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/materials/presets';
import {
  categoryOf,
  MATERIAL_CATEGORIES,
  presetsInCategory,
  searchPresets,
  uncategorisedPresets
} from '../src/ui/materialCategories';

describe('material radial categories', () => {
  it('places every preset in exactly one category', () => {
    // This is the guard that stops a newly added preset silently vanishing from the picker.
    expect(uncategorisedPresets()).toEqual([]);
    const total = MATERIAL_CATEGORIES.reduce(
      (sum, category) => sum + presetsInCategory(category.id).length,
      0
    );
    expect(total).toBe(MATERIAL_PRESETS.length);

    const seen = new Set<string>();
    for (const category of MATERIAL_CATEGORIES) {
      for (const preset of presetsInCategory(category.id)) {
        expect(seen.has(preset.id)).toBe(false);
        seen.add(preset.id);
      }
    }
    expect(seen.size).toBe(MATERIAL_PRESETS.length);
  });

  it('has no empty category, which would be a dead slot on the ring', () => {
    for (const category of MATERIAL_CATEGORIES) {
      expect(presetsInCategory(category.id).length).toBeGreaterThan(0);
    }
  });

  it('leaves a ring slot free alongside the categories', () => {
    // Eight slots read cleanly on the inner ring; the spare one carries All / search.
    expect(MATERIAL_CATEGORIES.length).toBeLessThanOrEqual(7);
    expect(new Set(MATERIAL_CATEGORIES.map((c) => c.id)).size).toBe(MATERIAL_CATEGORIES.length);
    for (const category of MATERIAL_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.glyph.length).toBeGreaterThan(0);
    }
  });

  it('prefers what a material is over where it came from', () => {
    // "Designer - Dense Grass" is tagged surface-designer AND grass; someone hunting for
    // grass should find it under Grass, while a brick wall falls through to Built.
    const denseGrass = MATERIAL_PRESETS.find((preset) => preset.id === 'designer-dense-grass');
    const brickWall = MATERIAL_PRESETS.find((preset) => preset.id === 'designer-old-brick-wall');
    expect(denseGrass).toBeDefined();
    expect(brickWall).toBeDefined();
    expect(categoryOf(denseGrass!)?.id).toBe('grass');
    expect(categoryOf(brickWall!)?.id).toBe('built');
  });

  it('searches name, description and tags', () => {
    expect(searchPresets('')).toEqual([]);
    const byName = searchPresets('cobble');
    expect(byName.length).toBeGreaterThan(0);
    expect(searchPresets('zzzznotathing')).toEqual([]);
  });
});
