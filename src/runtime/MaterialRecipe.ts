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
  RuntimeMaterialDefinition,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';

export const PTL_MATERIAL_FORMAT = 'ptl-material';
export const PTL_MATERIAL_VERSION = 3;
export const PTL_MATERIAL_FILE_SUFFIX = '.ptl.json';

const SURFACE_GRAPH_MATERIAL_VERSION = 2;
const LEGACY_MATERIAL_VERSION = 1;
const MAX_RECIPE_SEED = 0xffff_ffff;
const MAX_TEXTURE_DEPENDENCIES = 64;
const SAFE_DEPENDENCY_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;

export interface MaterialTextureDependency {
  id: string;
  version: 1;
}

export interface MaterialRecipeDependencies {
  textures: MaterialTextureDependency[];
}

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
  dependencies?: MaterialRecipeDependencies;
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

function graphContainsTextureField(graph: Readonly<SurfaceGraphDefinition>): boolean {
  return graph.nodes.some((node) => node.kind === 'texture-field') ||
    graph.subgraphs.some(graphContainsTextureField);
}

function textureDependenciesFromLayers(layers: readonly MaterialLayer[]): MaterialTextureDependency[] {
  const ids = [...new Set(layers
    .filter((layer) => layer.texture !== null && layer.texture !== undefined)
    .map((layer) => layer.texture!.id))]
    .sort((left, right) => left.localeCompare(right));
  return ids.map((id) => ({ id, version: 1 as const }));
}

function normalizeDependencies(
  value: unknown,
  layers: readonly MaterialLayer[]
): MaterialRecipeDependencies | undefined {
  const required = new Map(textureDependenciesFromLayers(layers).map((item) => [item.id, item] as const));
  if (value !== undefined && value !== null) {
    const input = asRecord(value, 'Material recipe dependencies');
    if (!Array.isArray(input.textures) || input.textures.length > MAX_TEXTURE_DEPENDENCIES) {
      throw new Error(`Material recipe texture dependencies must contain at most ${MAX_TEXTURE_DEPENDENCIES} entries.`);
    }
    const declared = new Set<string>();
    for (const [index, dependencyValue] of input.textures.entries()) {
      const dependency = asRecord(dependencyValue, `Texture dependency ${index + 1}`);
      if (typeof dependency.id !== 'string' || !SAFE_DEPENDENCY_ID.test(dependency.id)) {
        throw new Error(`Texture dependency ${index + 1} contains an invalid id.`);
      }
      if (dependency.version !== 1) {
        throw new Error(`Texture dependency ${dependency.id} uses unsupported version ${String(dependency.version)}.`);
      }
      if (declared.has(dependency.id)) {
        throw new Error(`Texture dependency ${dependency.id} is declared more than once.`);
      }
      if (!required.has(dependency.id)) {
        throw new Error(`Texture dependency ${dependency.id} is not referenced by a material layer.`);
      }
      declared.add(dependency.id);
    }
  }
  if (required.size === 0) return undefined;
  return { textures: [...required.values()] };
}

export function createMaterialRecipe(
  definition: Readonly<RuntimeMaterialDefinition>,
  seed = 0,
  coordinateSpace: MaterialCoordinateSpace = 'world',
  algorithms: Readonly<MaterialAlgorithmSettings> = DEFAULT_MATERIAL_ALGORITHMS
): MaterialRecipe {
  const surfaceGraph = definition.surfaceGraph === null || definition.surfaceGraph === undefined
    ? null
    : normalizeSurfaceGraph(definition.surfaceGraph);
  const compiled = surfaceGraph === null ? null : compileSurfaceGraph(surfaceGraph);
  const layers = compiled?.layers ?? definition.layers;
  return parseMaterialRecipe({
    format: PTL_MATERIAL_FORMAT,
    version: PTL_MATERIAL_VERSION,
    seed,
    coordinateSpace,
    algorithms,
    physical: definition.physical,
    synthesis: definition.synthesis,
    groups: compiled?.groups ?? definition.groups,
    layers,
    surfaceGraph,
    dependencies: normalizeDependencies(undefined, layers)
  });
}

export function parseMaterialRecipe(value: unknown): MaterialRecipe {
  const recipe = asRecord(value, 'Material recipe');
  if (recipe.format !== PTL_MATERIAL_FORMAT) throw new Error('File is not a Procedural Texture Lab material recipe.');
  const version = recipe.version;
  if (
    version !== PTL_MATERIAL_VERSION &&
    version !== SURFACE_GRAPH_MATERIAL_VERSION &&
    version !== LEGACY_MATERIAL_VERSION
  ) {
    throw new Error(`Unsupported material recipe version: ${String(version)}.`);
  }

  const surfaceGraph = version >= SURFACE_GRAPH_MATERIAL_VERSION
    ? graphDefinition(recipe.surfaceGraph)
    : null;
  if (
    version < PTL_MATERIAL_VERSION &&
    surfaceGraph !== null &&
    graphContainsTextureField(surfaceGraph)
  ) {
    throw new Error(`Texture-field material recipes require version ${PTL_MATERIAL_VERSION}.`);
  }

  const compiled = surfaceGraph === null ? null : compileSurfaceGraph(surfaceGraph);
  const normalized = normalizeRuntimeMaterialDefinition({
    physical: recipe.physical,
    synthesis: recipe.synthesis,
    groups: compiled?.groups ?? recipe.groups,
    layers: compiled?.layers ?? recipe.layers
  });
  if (
    version < PTL_MATERIAL_VERSION &&
    normalized.layers.some((layer) => layer.texture !== null && layer.texture !== undefined)
  ) {
    throw new Error(`Texture-field material recipes require version ${PTL_MATERIAL_VERSION}.`);
  }
  const dependencies = version === PTL_MATERIAL_VERSION
    ? normalizeDependencies(recipe.dependencies, normalized.layers)
    : undefined;

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
    surfaceGraph,
    ...(dependencies === undefined ? {} : { dependencies })
  };
}

/**
 * Re-seeds a recipe that parseMaterialRecipe has already returned.
 *
 * The recipe seed is applied by runtimeVariantLayers when the material syncs; it takes no part
 * in surface-graph lowering or layer normalization. Round-tripping through parseMaterialRecipe
 * to change it would recompile the graph and revalidate every layer only to rebuild identical
 * values, which is the dominant cost of generating seeded variants.
 */
export function reseedMaterialRecipe(
  recipe: Readonly<MaterialRecipe>,
  seed: number
): MaterialRecipe {
  return { ...recipe, seed: normalizeSeed(seed) };
}

export function serializeMaterialRecipe(
  source: Readonly<RuntimeMaterialDefinition> | Readonly<MaterialRecipe>,
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
