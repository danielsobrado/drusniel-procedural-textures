import {
  BLEND_MODES,
  CONTROL_RANGES,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PHYSICAL,
  ENVIRONMENTS,
  LAYER_CHANNELS,
  LAYER_KINDS,
  MAX_GROUPS,
  MAX_LAYERS,
  OBJECT_PRESETS
} from './constants';
import type {
  BlendMode,
  EnvironmentPreset,
  ImportedMeshTarget,
  LayerChannel,
  LayerKind,
  MaterialGroup,
  MaterialLayer,
  ObjectPreset,
  PhysicalSettings,
  ProjectState
} from '../materials/types';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const MAX_GROUP_DEPTH = 4;

export const MAX_LAYER_NAME_LENGTH = 120;
export const MAX_GROUP_NAME_LENGTH = 120;
export const MAX_IMPORTED_ASSET_NAME_LENGTH = 255;
export const MAX_MESH_LABEL_LENGTH = 160;

const OBJECT_IDS = new Set<ObjectPreset>(OBJECT_PRESETS.map((item) => item.id));
const LAYER_KIND_IDS = new Set<LayerKind>(LAYER_KINDS.map((item) => item.id));
const BLEND_MODE_IDS = new Set<BlendMode>(BLEND_MODES.map((item) => item.id));
const CHANNEL_IDS = new Set<LayerChannel>(LAYER_CHANNELS.map((item) => item.id));
const ENVIRONMENT_IDS = new Set<EnvironmentPreset>(ENVIRONMENTS.map((item) => item.id));

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${name} must be a string up to ${maxLength} characters.`);
  }
  return value;
}

function asNonEmptyString(value: unknown, name: string, maxLength: number): string {
  const text = asString(value, name, maxLength);
  if (text.trim().length === 0) {
    throw new Error(`${name} cannot be empty.`);
  }
  return text;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean.`);
  }
  return value;
}

function asFiniteNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function asControlNumber(
  value: unknown,
  name: string,
  range: Readonly<{ min: number; max: number }>
): number {
  return asFiniteNumber(value, name, range.min, range.max);
}

function asColor(value: unknown, name: string): string {
  const color = asString(value, name, 7);
  if (!HEX_COLOR.test(color)) {
    throw new Error(`${name} must be a six-digit hexadecimal color.`);
  }
  return color.toLowerCase();
}

function asId(value: unknown, name: string): string {
  const id = asString(value, name, 128);
  if (!SAFE_ID.test(id)) {
    throw new Error(`${name} contains unsupported characters.`);
  }
  return id;
}

function asNullableId(value: unknown, name: string): string | null {
  return value === null || value === undefined ? null : asId(value, name);
}

export function normalizeObjectPreset(value: unknown): ObjectPreset {
  if (typeof value !== 'string' || !OBJECT_IDS.has(value as ObjectPreset)) {
    throw new Error('Project contains an unsupported preview object.');
  }
  return value as ObjectPreset;
}

export function normalizeEnvironment(value: unknown): EnvironmentPreset {
  if (typeof value !== 'string' || !ENVIRONMENT_IDS.has(value as EnvironmentPreset)) {
    throw new Error('Project contains an unsupported environment.');
  }
  return value as EnvironmentPreset;
}

function asLayerKind(value: unknown, index: number): LayerKind {
  if (typeof value !== 'string' || !LAYER_KIND_IDS.has(value as LayerKind)) {
    throw new Error(`Layer ${index + 1} contains an unsupported generator.`);
  }
  return value as LayerKind;
}

function asBlendMode(value: unknown, index: number): BlendMode {
  if (typeof value !== 'string' || !BLEND_MODE_IDS.has(value as BlendMode)) {
    throw new Error(`Layer ${index + 1} contains an unsupported blend mode.`);
  }
  return value as BlendMode;
}

function asLayerChannel(value: unknown, index: number): LayerChannel {
  if (typeof value !== 'string' || !CHANNEL_IDS.has(value as LayerChannel)) {
    throw new Error(`Layer ${index + 1} contains an unsupported output channel.`);
  }
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
  const layer = asRecord(value, `Layer ${index + 1}`);
  return {
    id: asId(layer.id, `Layer ${index + 1} id`),
    name: normalizeLayerName(layer.name, `Layer ${index + 1} name`),
    kind: asLayerKind(layer.kind, index),
    enabled: asBoolean(layer.enabled, `Layer ${index + 1} enabled`),
    blendMode: asBlendMode(layer.blendMode, index),
    channel: asLayerChannel(layer.channel ?? 'surface', index),
    opacity: asControlNumber(layer.opacity, `Layer ${index + 1} opacity`, CONTROL_RANGES.layer.opacity),
    scale: asControlNumber(layer.scale, `Layer ${index + 1} scale`, CONTROL_RANGES.layer.scale),
    strength: asControlNumber(layer.strength, `Layer ${index + 1} strength`, CONTROL_RANGES.layer.strength),
    seed: asControlNumber(layer.seed, `Layer ${index + 1} seed`, CONTROL_RANGES.layer.seed),
    colorA: asColor(layer.colorA, `Layer ${index + 1} low color`),
    colorB: asColor(layer.colorB, `Layer ${index + 1} high color`),
    roughness: asControlNumber(layer.roughness, `Layer ${index + 1} roughness`, CONTROL_RANGES.layer.roughness),
    displacement: asControlNumber(
      layer.displacement,
      `Layer ${index + 1} displacement`,
      CONTROL_RANGES.layer.displacement
    ),
    groupId: asNullableId(layer.groupId, `Layer ${index + 1} group id`),
    maskSourceLayerId: asNullableId(layer.maskSourceLayerId, `Layer ${index + 1} mask source id`),
    maskInvert: layer.maskInvert === undefined
      ? false
      : asBoolean(layer.maskInvert, `Layer ${index + 1} mask invert`),
    maskStrength: layer.maskStrength === undefined
      ? 1
      : asControlNumber(
          layer.maskStrength,
          `Layer ${index + 1} mask strength`,
          CONTROL_RANGES.layer.maskStrength
        )
  };
}

export function normalizeMaterialGroup(value: unknown, index: number): MaterialGroup {
  const group = asRecord(value, `Group ${index + 1}`);
  return {
    id: asId(group.id, `Group ${index + 1} id`),
    name: normalizeGroupName(group.name, `Group ${index + 1} name`),
    parentId: asNullableId(group.parentId, `Group ${index + 1} parent id`),
    enabled: group.enabled === undefined ? true : asBoolean(group.enabled, `Group ${index + 1} enabled`),
    opacity: group.opacity === undefined
      ? 1
      : asControlNumber(group.opacity, `Group ${index + 1} opacity`, CONTROL_RANGES.group.opacity)
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

function normalizeGroups(value: unknown): MaterialGroup[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_GROUPS) {
    throw new Error(`Project groups must be an array with at most ${MAX_GROUPS} entries.`);
  }
  const groups = value.map(normalizeMaterialGroup);
  const ids = new Set(groups.map((group) => group.id));
  if (ids.size !== groups.length) {
    throw new Error('Project contains duplicate group ids.');
  }

  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    if (group.parentId !== null && !byId.has(group.parentId)) {
      throw new Error(`Group ${group.name} references a missing parent group.`);
    }
    let depth = 0;
    let current: MaterialGroup | undefined = group;
    const seen = new Set<string>();
    while (current?.parentId !== null && current?.parentId !== undefined) {
      if (seen.has(current.id)) {
        throw new Error('Project contains a cyclic group hierarchy.');
      }
      seen.add(current.id);
      current = byId.get(current.parentId);
      depth += 1;
      if (depth > MAX_GROUP_DEPTH) {
        throw new Error(`Material groups can be nested at most ${MAX_GROUP_DEPTH} levels.`);
      }
    }
  }
  return groups;
}

function normalizeImportedMeshes(value: unknown): ImportedMeshTarget[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 2048) {
    throw new Error('Imported mesh catalog is invalid or too large.');
  }
  const meshes = value.map((item, index) => {
    const mesh = asRecord(item, `Imported mesh ${index + 1}`);
    return {
      id: asId(mesh.id, `Imported mesh ${index + 1} id`),
      label: asNonEmptyString(mesh.label, `Imported mesh ${index + 1} label`, MAX_MESH_LABEL_LENGTH)
    };
  });
  const ids = new Set(meshes.map((mesh) => mesh.id));
  if (ids.size !== meshes.length) {
    throw new Error('Imported mesh catalog contains duplicate ids.');
  }
  return meshes;
}

function normalizeMeshAssignments(
  value: unknown,
  meshes: readonly ImportedMeshTarget[]
): Record<string, boolean> {
  const input = value === undefined ? {} : asRecord(value, 'Mesh assignments');
  const assignments: Record<string, boolean> = {};
  for (const mesh of meshes) {
    const assigned = input[mesh.id];
    assignments[mesh.id] = assigned === undefined ? true : asBoolean(assigned, `Mesh assignment ${mesh.id}`);
  }
  return assignments;
}

export function normalizeProject(value: unknown): ProjectState {
  const project = asRecord(value, 'Project');
  if (project.version !== 1 && project.version !== 2) {
    throw new Error(`Unsupported project version: ${String(project.version)}.`);
  }

  if (!Array.isArray(project.layers) || project.layers.length === 0) {
    throw new Error('Project material must contain at least one layer.');
  }
  if (project.layers.length > MAX_LAYERS) {
    throw new Error(`Project exceeds the ${MAX_LAYERS} layer limit.`);
  }

  const groups = normalizeGroups(project.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const layers = project.layers.map(normalizeMaterialLayer);
  const layerIds = new Set(layers.map((layer) => layer.id));
  if (layerIds.size !== layers.length) {
    throw new Error('Project contains duplicate layer ids.');
  }

  for (const layer of layers) {
    if (layer.groupId !== null && !groupIds.has(layer.groupId)) {
      throw new Error(`Layer ${layer.name} references a missing group.`);
    }
    if (layer.maskSourceLayerId !== null) {
      if (layer.maskSourceLayerId === layer.id) {
        throw new Error(`Layer ${layer.name} cannot mask itself.`);
      }
      if (!layerIds.has(layer.maskSourceLayerId)) {
        throw new Error(`Layer ${layer.name} references a missing mask source.`);
      }
    }
  }

  const requestedSelection = project.selectedLayerId;
  const selectedLayerId = typeof requestedSelection === 'string' && layerIds.has(requestedSelection)
    ? requestedSelection
    : layers.at(-1)?.id ?? null;

  const importedAssetName = project.importedAssetName === null || project.importedAssetName === undefined
    ? null
    : normalizeImportedAssetName(project.importedAssetName);
  const importedMeshes = normalizeImportedMeshes(project.importedMeshes);
  const meshIds = new Set(importedMeshes.map((mesh) => mesh.id));
  const selectedMeshId = typeof project.selectedMeshId === 'string' && meshIds.has(project.selectedMeshId)
    ? project.selectedMeshId
    : importedMeshes[0]?.id ?? null;

  const environment = project.environment === undefined
    ? DEFAULT_ENVIRONMENT
    : normalizeEnvironment(project.environment);
  const environmentAssetName = project.environmentAssetName === null || project.environmentAssetName === undefined
    ? null
    : asNonEmptyString(
        project.environmentAssetName,
        'Environment asset name',
        MAX_IMPORTED_ASSET_NAME_LENGTH
      );

  return {
    version: 2,
    selectedObject: normalizeObjectPreset(project.selectedObject),
    selectedLayerId,
    importedAssetName,
    importedMeshes,
    selectedMeshId,
    meshAssignments: normalizeMeshAssignments(project.meshAssignments, importedMeshes),
    environment,
    environmentAssetName,
    background: normalizeBackgroundColor(project.background),
    wireframe: asBoolean(project.wireframe, 'Wireframe'),
    physical: normalizePhysicalSettings(project.physical),
    groups,
    layers
  };
}
