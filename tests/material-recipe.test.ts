import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import { PTL_ALGORITHM_VERSION } from '../src/core/material/MaterialAlgorithms';
import { SURFACE_DESIGNER_CATALOG } from '../src/materials/surfaceDesignerCatalog';
import {
  createMaterialRecipe,
  parseMaterialRecipe,
  PTL_MATERIAL_FORMAT,
  PTL_MATERIAL_VERSION,
  serializeMaterialRecipe
} from '../src/runtime/MaterialRecipe';

describe('portable material recipes', () => {
  it('round-trips only runtime material state', () => {
    const project = createDefaultProject();
    project.physical.roughness = 0.37;
    project.synthesis.age = 0.62;
    project.layers[1]!.scale = 8.25;

    const document = JSON.parse(serializeMaterialRecipe(project, 83721)) as Record<string, unknown>;
    const recipe = parseMaterialRecipe(document);

    expect(document.format).toBe(PTL_MATERIAL_FORMAT);
    expect(document.version).toBe(PTL_MATERIAL_VERSION);
    expect(document.seed).toBe(83721);
    expect(document).not.toHaveProperty('selectedObject');
    expect(document).not.toHaveProperty('environment');
    expect(recipe.coordinateSpace).toBe('world');
    expect(recipe.algorithms.version).toBe(PTL_ALGORITHM_VERSION);
    expect(recipe.physical.roughness).toBe(0.37);
    expect(recipe.synthesis.age).toBe(0.62);
    expect(recipe.layers[1]!.scale).toBe(8.25);
    expect(recipe.surfaceGraph).toBeNull();
  });

  it('supports object-space recipes for moving game objects', () => {
    const recipe = createMaterialRecipe(createDefaultProject(), 42, 'object');
    const parsed = parseMaterialRecipe(recipe);
    expect(parsed.coordinateSpace).toBe('object');
  });

  it('migrates legacy version-one recipes with portable defaults', () => {
    const recipe = createMaterialRecipe(createDefaultProject(), 42);
    const legacy = { ...recipe, version: 1 } as Record<string, unknown>;
    delete legacy.coordinateSpace;
    delete legacy.algorithms;
    delete legacy.surfaceGraph;
    delete legacy.dependencies;

    const parsed = parseMaterialRecipe(legacy);
    expect(parsed.version).toBe(PTL_MATERIAL_VERSION);
    expect(parsed.coordinateSpace).toBe('world');
    expect(parsed.algorithms.version).toBe(PTL_ALGORITHM_VERSION);
    expect(parsed.algorithms.reactionDiffusion.iterations).toBeGreaterThan(0);
    expect(parsed.surfaceGraph).toBeNull();
  });

  it('migrates version-two graph recipes to the current format', () => {
    const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    if (preset === undefined) throw new Error('Brick designer preset is missing.');
    const state = new AppState(createDefaultProject());
    state.applyPreset(preset);
    const current = createMaterialRecipe(state.snapshot, 42);
    const legacy = { ...current, version: 2 } as Record<string, unknown>;
    delete legacy.dependencies;

    const parsed = parseMaterialRecipe(legacy);
    expect(parsed.version).toBe(PTL_MATERIAL_VERSION);
    expect(parsed.surfaceGraph?.id).toBe('designer-old-brick-wall');
    expect(parsed.layers.some((layer) => layer.kind === 'pattern')).toBe(true);
  });

  it('exports graph-backed presets and regenerates canonical runtime layers', () => {
    const preset = SURFACE_DESIGNER_CATALOG.find((item) => item.id === 'designer-old-brick-wall');
    expect(preset?.graph).toBeDefined();
    if (preset === undefined) throw new Error('Brick designer preset is missing.');

    const state = new AppState(createDefaultProject());
    state.applyPreset(preset);
    const recipe = createMaterialRecipe(state.snapshot, 73, 'object');
    const parsed = parseMaterialRecipe(JSON.parse(serializeMaterialRecipe(recipe)) as unknown);

    expect(parsed.version).toBe(PTL_MATERIAL_VERSION);
    expect(parsed.surfaceGraph?.id).toBe('designer-old-brick-wall');
    expect(parsed.layers.some((layer) => layer.kind === 'pattern')).toBe(true);
    expect(parsed.layers.every((layer) => layer.kind !== 'pattern' || layer.pattern !== null)).toBe(true);
    expect(parsed.groups).toEqual(recipe.groups);
  });

  it('creates a detached recipe snapshot', () => {
    const project = createDefaultProject();
    const recipe = createMaterialRecipe(project, 42);
    project.layers[0]!.colorA = '#ffffff';

    expect(recipe.layers[0]!.colorA).not.toBe('#ffffff');
  });

  it('rejects unsupported formats, versions, algorithms and non-portable seeds', () => {
    const recipe = createMaterialRecipe(createDefaultProject());
    expect(() => parseMaterialRecipe({ ...recipe, format: 'other' })).toThrow(/not a Procedural Texture Lab/u);
    expect(() => parseMaterialRecipe({ ...recipe, version: PTL_MATERIAL_VERSION + 1 })).toThrow(/unsupported material recipe version/iu);
    expect(() => parseMaterialRecipe({ ...recipe, seed: -1 })).toThrow(/seed must be an integer/u);
    expect(() => parseMaterialRecipe({ ...recipe, seed: 1.5 })).toThrow(/seed must be an integer/u);
    expect(() => parseMaterialRecipe({
      ...recipe,
      algorithms: { ...recipe.algorithms, version: 99 }
    })).toThrow(/unsupported material algorithm version/iu);
  });

  it('validates graph references through the runtime material schema', () => {
    const recipe = createMaterialRecipe(createDefaultProject());
    recipe.layers[0]!.maskSourceLayerId = 'missing-layer';
    expect(() => parseMaterialRecipe(recipe)).toThrow(/missing mask source/u);
  });
});
