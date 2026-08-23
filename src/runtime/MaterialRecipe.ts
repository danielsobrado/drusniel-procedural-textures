import type { SurfaceGraphDefinition } from '../core/graph/SurfaceGraph';
import { normalizeSurfaceGraph } from '../core/graph/SurfaceGraphValidation';
import type { MaterialAlgorithmSettings } from '../core/material/MaterialAlgorithms';
import {
  DEFAULT_MATERIAL_ALGORITHMS,
  normalizeMaterialAlgorithms
} from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { normalizeMaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { normalizeRuntimeMaterialDefinition } from '../core/material/RuntimeMaterialSchema';
import { compileSurfaceGraph } from '../materials/SurfaceGraphCompiler';
import type {
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  ProjectState,
  SynthesisSettings
} from '../materials/types';

export const PTL_MATERIAL_FORMAT = 'ptl-material';
export const PTL_MATERIAL_VERSION = 2;
export const PTL_MATERIAL_FILE_SUFFIX = '.ptl.json';

const LEGACY_MATERIAL_VERSION = 1;
const MAX_RECIPE_SEED = 0xffff_ffff;

export interface MaterialRecipe {
  format: typeof PTL_MATERIAL_FORMAT;
  version: typeof PTL_MATERIAL_VERSION;
  seed: number;
  coordinateSpace: MaterialCoordinateSpace;
  algorithms: MaterialAlgorithmSettings;
  physical: PhysicalSettings;
  synthesis: SynthesisSettings;
  groups: MaterialGroup[];
  layers: MaterialLayer[];
  surfaceGraph: SurfaceGraphDefinition | null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function normalizeSeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_RECIPE_SEED) {
    throw new Error(`Material recipe seed must be an integer between 0 and ${MAX_RECIPE_SEED}.`);
  }
  return value;
}

function graphDefinition(value: unknown): SurfaceGraphDefinition | null {
  if (value === null || value === undefined) return null;
  return normalizeSurfaceGraph(value);
}

export function createMaterialRecipe(
  state: Readonly<ProjectState>,
  seed = 0,
  coordinateSpace: MaterialCoordinateSpace = 'world',
  algorithms: Readonly<MaterialAlgorithmSettings> = DEFAULT_MATERIAL_ALGORITHMS
): MaterialRecipe {
  const surfaceGraph = state.surfaceGraph === null || state.surfaceGraph === undefined
    ? null
    : normalizeSurfaceGraph(state.surfaceGraph);
  const compiled = surfaceGraph === null ? null : compileSurfaceGraph(surfaceGraph);
  return parseMaterialRecipe({
    format: PTL_MATERIAL_FORMAT,
    version: PTL_MATERIAL_VERSION,
    seed,
    coordinateSpace,
    algorithms,
    physical: state.physical,
    synthesis: state.synthesis,
    groups: compiled?.groups ?? state.groups,
    layers: compiled?.layers ?? state.layers,
    surfaceGraph
  });
}

export function parseMaterialRecipe(value: unknown): MaterialRecipe {
  const recipe = asRecord(value, 'Material recipe');
  if (recipe.format !== PTL_MATERIAL_FORMAT) throw new Error('File is not a Procedural Texture Lab material recipe.');
  if (recipe.version !== PTL_MATERIAL_VERSION && recipe.version !== LEGACY_MATERIAL_VERSION) {
    throw new Error(`Unsupported material recipe version: ${String(recipe.version)}.`);
  }

  const surfaceGraph = recipe.version === PTL_MATERIAL_VERSION
    ? graphDefinition(recipe.surfaceGraph)
    : null;
  const compiled = surfaceGraph === null ? null : compileSurfaceGraph(surfaceGraph);
  const normalized = normalizeRuntimeMaterialDefinition({
    physical: recipe.physical,
    synthesis: recipe.synthesis,
    groups: compiled?.groups ?? recipe.groups,
    layers: compiled?.layers ?? recipe.layers
  });

  return {
    format: PTL_MATERIAL_FORMAT,
    version: PTL_MATERIAL_VERSION,
    seed: normalizeSeed(recipe.seed),
    coordinateSpace: normalizeMaterialCoordinateSpace(recipe.coordinateSpace),
    algorithms: normalizeMaterialAlgorithms(recipe.algorithms),
    physical: normalized.physical,
    synthesis: normalized.synthesis,
    groups: normalized.groups,
    layers: normalized.layers,
    surfaceGraph
  };
}

export function serializeMaterialRecipe(
  source: Readonly<ProjectState> | Readonly<MaterialRecipe>,
  seed = 'format' in source ? source.seed : 0
): string {
  const recipe = 'format' in source ? parseMaterialRecipe(source) : createMaterialRecipe(source, seed);
  return `${JSON.stringify(recipe, null, 2)}\n`;
}

export async function loadMaterialRecipe(input: RequestInfo | URL, init?: RequestInit): Promise<MaterialRecipe> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(`Could not load PTL material recipe (${response.status} ${response.statusText}).`);
  return parseMaterialRecipe(await response.json() as unknown);
}
