import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';
import {
  createMaterialRecipe,
  parseMaterialRecipe,
  reseedMaterialRecipe
} from '../src/runtime/MaterialRecipe';

/**
 * reseedMaterialRecipe skips the parse round-trip, so it has to stay observably identical to it.
 * A surface-graph recipe is the case that matters: parseMaterialRecipe recompiles the graph, and
 * the shortcut has to reproduce those lowered layers exactly.
 */
describe('material recipe reseeding', () => {
  it('matches a full reparse for a plain recipe', () => {
    const recipe = createMaterialRecipe(createDefaultProject(), 42);

    expect(reseedMaterialRecipe(recipe, 8675309)).toEqual(
      parseMaterialRecipe({ ...recipe, seed: 8675309 })
    );
  });

  it('matches a full reparse for a surface-graph recipe', () => {
    const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    if (preset === undefined) throw new Error('Brick designer preset is missing.');
    const state = new AppState(createDefaultProject());
    state.applyPreset(preset);
    const recipe = createMaterialRecipe(state.snapshot, 42);
    expect(recipe.surfaceGraph).not.toBeNull();

    expect(reseedMaterialRecipe(recipe, 123456)).toEqual(
      parseMaterialRecipe({ ...recipe, seed: 123456 })
    );
  });

  it('still rejects a seed the parser would reject', () => {
    const recipe = createMaterialRecipe(createDefaultProject(), 42);

    expect(() => reseedMaterialRecipe(recipe, -1)).toThrow(/seed/iu);
    expect(() => reseedMaterialRecipe(recipe, 1.5)).toThrow(/seed/iu);
    expect(() => reseedMaterialRecipe(recipe, 0x1_0000_0000)).toThrow(/seed/iu);
  });
});
