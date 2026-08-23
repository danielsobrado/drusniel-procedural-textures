import { normalizeSurfaceGraph } from '../core/graph/SurfaceGraphValidation';
import { DEFAULT_PATTERN_SETTINGS, normalizePatternSettings } from '../core/material/PatternSettings';
import { compileMaterialGraph, materialGraphHasCycle } from '../materials/MaterialGraph';
import { compileSurfaceGraph } from '../materials/SurfaceGraphCompiler';
import type {
  BlendMode,
  EnvironmentPreset,
  GenomeLocks,
  ImportedMeshTarget,
  LayerChannel,
  LayerKind,
  MaterialGroup,
  MaterialLayer,
  ObjectPreset,
  PhysicalSettings,
  ProjectState,
  SynthesisSettings
} from '../materials/types';
import {
  BLEND_MODES,
  CONTROL_RANGES,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PHYSICAL,
  DEFAULT_SYNTHESIS,
  ENVIRONMENTS,
  LAYER_CHANNELS,
  LAYER_KINDS,
  MAX_GROUP_DEPTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS,
  MAX_IMPORTED_ASSET_NAME_LENGTH,
  MAX_IMPORTED_MESHES,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYERS,
  MAX_MESH_LABEL_LENGTH,
  OBJECT_PRESETS
} from './constants';

export { MAX_GROUP_NAME_LENGTH, MAX_IMPORTED_MESHES, MAX_LAYER_NAME_LENGTH } from './constants';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const OBJECT_IDS = new Set<ObjectPreset>(OBJECT_PRESETS.map((item) => item.id));
const LAYER_KIND_IDS = new Set<LayerKind>(LAYER_KINDS.map((item) => item.id));
const BLEND_MODE_IDS = new Set<BlendMode>(BLEND_MODES.map((item) => item.id));
const CHANNEL_IDS = new Set<LayerChannel>(LAYER_CHANNELS.map((item) => item.id));
const ENVIRONMENT_IDS = new Set<EnvironmentPreset>(ENVIRONMENTS.map((item) => item.id));

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${name} must be a string up to ${maxLength} characters.`);
  return value;
}

function asNonEmptyString(value: unknown, name: string, maxLength: number): string {
  const result = asString(value, name, maxLength);
  if (result.trim().length === 0) throw new Error(`${name} cannot be empty.`);
  return result;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function asFiniteNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function asControlNumber(value: unknown, name: string, range: Readonly<{ min: number; max: number }>): number {
  return asFiniteNumber(value, name, range.min, range.max);
}

function asColor(value: unknown, name: string): string {
  const result = asString(value, name, 7);
  if (!HEX_COLOR.test(result)) throw new Error(`${name} must be a six-digit hexadecimal color.`);
  return result.toLowerCase();
}

function asId(value: unknown, name: string): string {
  const result = asString(value, name, 128);
  if (!SAFE_ID.test(result)) throw new Error(`${name} contains unsupported characters.`);
  return result;
}

function asNullableId(value: unknown, name: string): string | null {
  return value === null || value === undefined ? null : asId(value, name);
}

export function normalizeObjectPreset(value: unknown): ObjectPreset {
  if (typeof value !== 'string' || !OBJECT_IDS.has(value as ObjectPreset)) throw new Error('Project contains an unsupported preview object.');
  return value as ObjectPreset;
}

export function normalizeEnvironment(value: unknown): EnvironmentPreset {
  if (typeof value !== 'string' || !ENVIRONMENT_IDS.has(value as EnvironmentPreset)) throw new Error('Project contains an unsupported environment.');
  return value as EnvironmentPreset;
}

function asLayerKind(value: unknown, index: number): LayerKind {
  if (typeof value !== 'string' || !LAYER_KIND_IDS.has(value as LayerKind)) throw new Error(`Layer ${index + 1} contains an unsupported generator.`);
  return value as LayerKind;
}

function asBlendMode(value: unknown, index: number): BlendMode {
  if (typeof value !== 'string' || !BLEND_MODE_IDS.has(value as BlendMode)) throw new Error(`Layer ${index + 1} contains an unsupported blend mode.`);
  return value as BlendMode;
}

function asLayerChannel(value: unknown, index: number): LayerChannel {
  if (typeof value !== 'string' || !CHANNEL_IDS.has(value as LayerChannel)) throw new Error(`Layer ${index + 1} contains an unsupported output channel.`);
  return value as LayerChannel;
}

export function normalizeLayerName(value: unknown, name = 'Layer name'): string {
  return asString(value, name, MAX_LAYER_NAME_LENGTH);
}

export function normalizeGroupName(value: unknown, name = 'Group name'): string {
  return asString(value, name, MAX_GROUP_NAME_LENGTH);
}

export function normalizeImportedAssetName(value: unknown): string {
  return asNonEmptyString(value, 'Imported asset name', MAX_IMPORTED_ASSET_NAME_LENGTH);
}

export function normalizeBackgroundColor(value: unknown): string {
  return asColor(value, 'Background color');
}

export function normalizeMaterialLayer(value: unknown, index: number): MaterialLayer {
  const input = asRecord(value, `Layer ${index + 1}`);
  const kind = asLayerKind(input.kind, index);
  return {
    id: asId(input.id, `Layer ${index + 1} id`),
    name: normalizeLayerName(input.name, `Layer ${index + 1} name`),
    kind,
    enabled: asBoolean(input.enabled, `Layer ${index + 1} enabled`),
    blendMode: asBlendMode(input.blendMode, index),
    channel: asLayerChannel(input.channel ?? 'surface', index),
    opacity: asControlNumber(input.opacity, `Layer ${index + 1} opacity`, CONTROL_RANGES.layer.opacity),
    scale: asControlNumber(input.scale, `Layer ${index + 1} scale`, CONTROL_RANGES.layer.scale),
    strength: asControlNumber(input.strength, `Layer ${index + 1} strength`, CONTROL_RANGES.layer.strength),
    seed: asControlNumber(input.seed, `Layer ${index + 1} seed`, CONTROL_RANGES.layer.seed),
    colorA: asColor(input.colorA, `Layer ${index + 1} low color`),
    colorB: asColor(input.colorB, `Layer ${index + 1} high color`),
    roughness: asControlNumber(input.roughness, `Layer ${index + 1} roughness`, CONTROL_RANGES.layer.roughness),
    displacement: asControlNumber(input.displacement, `Layer ${index + 1} displacement`, CONTROL_RANGES.layer.displacement),
    groupId: asNullableId(input.groupId, `Layer ${index + 1} group id`),
    maskSourceLayerId: asNullableId(input.maskSourceLayerId, `Layer ${index + 1} mask source id`),
    structureSourceLayerId: asNullableId(input.structureSourceLayerId, `Layer ${index + 1} structure source id`),
    maskInvert: input.maskInvert === undefined ? false : asBoolean(input.maskInvert, `Layer ${index + 1} mask invert`),
    maskStrength: input.maskStrength === undefined
      ? 1
      : asControlNumber(input.maskStrength, `Layer ${index + 1} mask strength`, CONTROL_RANGES.layer.maskStrength),
    pattern: kind === 'pattern'
      ? normalizePatternSettings(input.pattern ?? DEFAULT_PATTERN_SETTINGS)
      : null
  };
}

export function normalizeMaterialGroup(value: unknown, index: number): MaterialGroup {
  const input = asRecord(value, `Group ${index + 1}`);
  return {
    id: asId(input.id, `Group ${index + 1} id`),
    name: normalizeGroupName(input.name, `Group ${index + 1} name`),
    parentId: asNullableId(input.parentId, `Group ${index + 1} parent id`),
    enabled: input.enabled === undefined ? true : asBoolean(input.enabled, `Group ${index + 1} enabled`),
    opacity: input.opacity === undefined ? 1 : asControlNumber(input.opacity, `Group ${index + 1} opacity`, CONTROL_RANGES.group.opacity)
  };
}

export function normalizePhysicalSettings(value: unknown): PhysicalSettings {
  const input = value === undefined ? {} : asRecord(value, 'Physical material settings');
  const merged: Record<string, unknown> = { ...DEFAULT_PHYSICAL, ...input };
  const number = (key: keyof typeof CONTROL_RANGES.physical, label: string): number =>
    asControlNumber(merged[key], label, CONTROL_RANGES.physical[key]);
  return {
    roughness: number('roughness', 'Physical roughness'),
    metalness: number('metalness', 'Physical metalness'),
    clearcoat: number('clearcoat', 'Physical clearcoat'),
    clearcoatRoughness: number('clearcoatRoughness', 'Physical clearcoat roughness'),
    specularIntensity: number('specularIntensity', 'Physical specular intensity'),
    ior: number('ior', 'Physical IOR'),
    sheen: number('sheen', 'Physical sheen'),
    sheenRoughness: number('sheenRoughness', 'Physical sheen roughness'),
    sheenColor: asColor(merged.sheenColor, 'Physical sheen color'),
    transmission: number('transmission', 'Physical transmission'),
    thickness: number('thickness', 'Physical thickness'),
    attenuationDistance: number('attenuationDistance', 'Physical attenuation distance'),
    attenuationColor: asColor(merged.attenuationColor, 'Physical attenuation color')
  };
}

export function normalizeSynthesisSettings(value: unknown): SynthesisSettings {
  const input = value === undefined ? {} : asRecord(value, 'Material synthesis settings');
  const merged = { ...DEFAULT_SYNTHESIS, ...input };
  return {
    age: asControlNumber(merged.age, 'Synthesis age', CONTROL_RANGES.synthesis.age),
    weathering: asControlNumber(merged.weathering, 'Synthesis weathering', CONTROL_RANGES.synthesis.weathering),
    gravity: asControlNumber(merged.gravity, 'Synthesis gravity', CONTROL_RANGES.synthesis.gravity),
    macro: asControlNumber(merged.macro, 'Synthesis macro scale', CONTROL_RANGES.synthesis.macro),
    meso: asControlNumber(merged.meso, 'Synthesis meso scale', CONTROL_RANGES.synthesis.meso),
    micro: asControlNumber(merged.micro, 'Synthesis micro scale', CONTROL_RANGES.synthesis.micro),
    variation: asControlNumber(merged.variation, 'Synthesis variation', CONTROL_RANGES.synthesis.variation),
    stochasticTiling: asControlNumber(merged.stochasticTiling, 'Synthesis stochastic tiling', CONTROL_RANGES.synthesis.stochasticTiling)
  };
}

function normalizeGenomeLocks(value: unknown): GenomeLocks {
  const input = value === undefined ? {} : asRecord(value, 'Material genome locks');
  return {
    color: input.color === undefined ? false : asBoolean(input.color, 'Genome color lock'),
    structure: input.structure === undefined ? false : asBoolean(input.structure, 'Genome structure lock'),
    roughness: input.roughness === undefined ? false : asBoolean(input.roughness, 'Genome roughness lock'),
    scale: input.scale === undefined ? false : asBoolean(input.scale, 'Genome scale lock'),
    damage: input.damage === undefined ? false : asBoolean(input.damage, 'Genome damage lock')
  };
}

function normalizeGroups(value: unknown): MaterialGroup[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_GROUPS) throw new Error(`Project groups must be an array with at most ${MAX_GROUPS} entries.`);
  const groups = value.map(normalizeMaterialGroup);
  const ids = new Set(groups.map((group) => group.id));
  if (ids.size !== groups.length) throw new Error('Project contains duplicate group ids.');
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    if (group.parentId !== null && !byId.has(group.parentId)) throw new Error(`Group ${group.name} references a missing parent group.`);
    let depth = 0;
    let current: MaterialGroup | undefined = group;
    const seen = new Set<string>();
    while (current?.parentId !== null && current?.parentId !== undefined) {
      if (seen.has(current.id)) throw new Error('Project contains a cyclic group hierarchy.');
      seen.add(current.id);
      current = byId.get(current.parentId);
      depth += 1;
      if (depth > MAX_GROUP_DEPTH) throw new Error(`Material groups can be nested at most ${MAX_GROUP_DEPTH} levels.`);
    }
  }
  return groups;
}

function normalizeImportedMeshes(value: unknown): ImportedMeshTarget[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMPORTED_MESHES) throw new Error(`Imported mesh catalog must contain at most ${MAX_IMPORTED_MESHES} entries.`);
  const meshes = value.map((item, index) => {
    const input = asRecord(item, `Imported mesh ${index + 1}`);
    return {
      id: asId(input.id, `Imported mesh ${index + 1} id`),
      label: asNonEmptyString(input.label, `Imported mesh ${index + 1} label`, MAX_MESH_LABEL_LENGTH)
    };
  });
  if (new Set(meshes.map((mesh) => mesh.id)).size !== meshes.length) throw new Error('Imported mesh catalog contains duplicate ids.');
  return meshes;
}

function normalizeMeshAssignments(value: unknown, meshes: readonly ImportedMeshTarget[]): Record<string, boolean> {
  const input = value === undefined ? {} : asRecord(value, 'Mesh assignments');
  return Object.fromEntries(meshes.map((mesh) => [
    mesh.id,
    input[mesh.id] === undefined ? true : asBoolean(input[mesh.id], `Mesh assignment ${mesh.id}`)
  ]));
}

export function normalizeProject(value: unknown): ProjectState {
  const project = asRecord(value, 'Project');
  if (project.version !== 1 && project.version !== 2) throw new Error(`Unsupported project version: ${String(project.version)}.`);
  if (!Array.isArray(project.layers) || project.layers.length === 0) throw new Error('Project material must contain at least one layer.');
  if (project.layers.length > MAX_LAYERS) throw new Error(`Project exceeds the ${MAX_LAYERS} layer limit.`);

  const storedGroups = normalizeGroups(project.groups);
  const storedGroupIds = new Set(storedGroups.map((group) => group.id));
  const storedLayers = project.layers.map(normalizeMaterialLayer);
  const storedLayerIds = new Set(storedLayers.map((layer) => layer.id));
  if (storedLayerIds.size !== storedLayers.length) throw new Error('Project contains duplicate layer ids.');

  for (const layer of storedLayers) {
    if (layer.groupId !== null && !storedGroupIds.has(layer.groupId)) throw new Error(`Layer ${layer.name} references a missing group.`);
    if (layer.maskSourceLayerId !== null) {
      if (layer.maskSourceLayerId === layer.id) throw new Error(`Layer ${layer.name} cannot mask itself.`);
      if (!storedLayerIds.has(layer.maskSourceLayerId)) throw new Error(`Layer ${layer.name} references a missing mask source.`);
    }
    if (layer.structureSourceLayerId !== null) {
      if (layer.structureSourceLayerId === layer.id) throw new Error(`Layer ${layer.name} cannot use itself as a structure source.`);
      if (!storedLayerIds.has(layer.structureSourceLayerId)) throw new Error(`Layer ${layer.name} references a missing structure source.`);
    }
  }
  if (materialGraphHasCycle(compileMaterialGraph(storedLayers))) throw new Error('Project contains a cyclic material graph.');

  const surfaceGraph = project.surfaceGraph === null || project.surfaceGraph === undefined
    ? null
    : normalizeSurfaceGraph(project.surfaceGraph);
  const graphCompilation = surfaceGraph === null ? null : compileSurfaceGraph(surfaceGraph);
  const groups = graphCompilation?.groups ?? storedGroups;
  const layers = graphCompilation?.layers ?? storedLayers;
  const layerIds = new Set(layers.map((layer) => layer.id));

  const requestedSelection = project.selectedLayerId;
  const storedSelectionIndex = typeof requestedSelection === 'string'
    ? storedLayers.findIndex((layer) => layer.id === requestedSelection)
    : -1;
  const storedSelectionName = storedSelectionIndex < 0 ? undefined : storedLayers[storedSelectionIndex]?.name;
  const selectedLayerId = typeof requestedSelection === 'string' && layerIds.has(requestedSelection)
    ? requestedSelection
    : storedSelectionName !== undefined
      ? layers.find((layer) => layer.name === storedSelectionName)?.id ?? layers[storedSelectionIndex]?.id ?? layers.at(-1)?.id ?? null
      : layers.at(-1)?.id ?? null;

  const importedAssetName = project.importedAssetName === null || project.importedAssetName === undefined
    ? null
    : normalizeImportedAssetName(project.importedAssetName);
  const importedMeshes = importedAssetName === null ? [] : normalizeImportedMeshes(project.importedMeshes);
  const meshIds = new Set(importedMeshes.map((mesh) => mesh.id));
  const selectedMeshId = importedAssetName !== null && typeof project.selectedMeshId === 'string' && meshIds.has(project.selectedMeshId)
    ? project.selectedMeshId
    : importedMeshes[0]?.id ?? null;
  const meshAssignments = importedAssetName === null ? {} : normalizeMeshAssignments(project.meshAssignments, importedMeshes);

  const environment = project.environment === undefined ? DEFAULT_ENVIRONMENT : normalizeEnvironment(project.environment);
  let environmentAssetName: string | null = null;
  if (environment === 'custom') {
    if (project.environmentAssetName === null || project.environmentAssetName === undefined) {
      throw new Error('Custom environment projects must include the HDR asset name required for restoration.');
    }
    environmentAssetName = asNonEmptyString(project.environmentAssetName, 'Environment asset name', MAX_IMPORTED_ASSET_NAME_LENGTH);
  }

  return {
    version: 2,
    selectedObject: normalizeObjectPreset(project.selectedObject),
    selectedLayerId,
    importedAssetName,
    importedMeshes,
    selectedMeshId,
    meshAssignments,
    environment,
    environmentAssetName,
    background: normalizeBackgroundColor(project.background),
    wireframe: asBoolean(project.wireframe, 'Wireframe'),
    physical: normalizePhysicalSettings(project.physical),
    synthesis: normalizeSynthesisSettings(project.synthesis),
    genomeLocks: normalizeGenomeLocks(project.genomeLocks),
    graphMode: project.graphMode === undefined ? false : asBoolean(project.graphMode, 'Graph mode'),
    surfaceGraph: graphCompilation?.graph ?? null,
    groups,
    layers
  };
}
