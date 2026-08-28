import type { MaterialAlgorithmSettings } from '../core/material/MaterialAlgorithms';
import { DEFAULT_MATERIAL_ALGORITHMS } from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import type { ProjectState } from '../materials/types';
import {
  createMaterialRecipe,
  serializeMaterialRecipe,
  type MaterialRecipe
} from '../runtime/MaterialRecipe';

/** Lab-only adapter from editor project state to the portable material seam. */
export function createMaterialRecipeFromProject(
  project: Readonly<ProjectState>,
  seed = 0,
  coordinateSpace: MaterialCoordinateSpace = 'world',
  algorithms: Readonly<MaterialAlgorithmSettings> = DEFAULT_MATERIAL_ALGORITHMS
): MaterialRecipe {
  return createMaterialRecipe(project, seed, coordinateSpace, algorithms);
}

export function serializeMaterialRecipeFromProject(
  project: Readonly<ProjectState>,
  seed = 0
): string {
  return serializeMaterialRecipe(createMaterialRecipeFromProject(project, seed));
}
