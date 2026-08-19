import {
  BLEND_MODES,
  CONTROL_RANGES,
  DEFAULT_PHYSICAL,
  LAYER_KINDS,
  MAX_LAYERS,
  OBJECT_PRESETS
} from './constants';
import type {
  BlendMode,
  LayerKind,
  MaterialLayer,
  ObjectPreset,
  PhysicalSettings,
  ProjectState
} from '../materials/types';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

export const MAX_LAYER_NAME_LENGTH = 120;
export const MAX_IMPORTED_ASSET_NAME_LENGTH = 255;

const OBJECT_IDS = new Set<ObjectPreset>(OBJECT_PRESETS.map((item) => item.id));
const LAYER_KIND_IDS = new Set<LayerKind>(LAYER_KINDS.map((item) => item.id));
const BLEND_MODE_IDS = new Set<BlendMode>(BLEND_MODES.map((item) => item.id));

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

function asFiniteNumber(
  value: unknown,
  name: string,
  min: number,
  max: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
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

function asObjectPreset(value: unknown): ObjectPreset {
  if (typeof value !== 'string' || !OBJECT_IDS.has(value as ObjectPreset)) {
    throw new Error('Project contains an unsupported preview object.');
  }
  return value as ObjectPreset;
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

export function normalizeLayerName(value: unknown, name = 'Layer name'): string {
  return asString(value, name, MAX_LAYER_NAME_LENGTH);
}

export function normalizeImportedAssetName(value: unknown): string {
  return asNonEmptyString(
    value,
    'Imported asset name',
    MAX_IMPORTED_ASSET_NAME_LENGTH
  );
}

function normalizeLayer(value: unknown, index: number): MaterialLayer {
  const layer = asRecord(value, `Layer ${index + 1}`);
  return {
    id: asId(layer.id, `Layer ${index + 1} id`),
    name: normalizeLayerName(layer.name, `Layer ${index + 1} name`),
    kind: asLayerKind(layer.kind, index),
    enabled: asBoolean(layer.enabled, `Layer ${index + 1} enabled`),
    blendMode: asBlendMode(layer.blendMode, index),
    opacity: asControlNumber(
      layer.opacity,
      `Layer ${index + 1} opacity`,
      CONTROL_RANGES.layer.opacity
    ),
    scale: asControlNumber(
      layer.scale,
      `Layer ${index + 1} scale`,
      CONTROL_RANGES.layer.scale
    ),
    strength: asControlNumber(
      layer.strength,
      `Layer ${index + 1} strength`,
      CONTROL_RANGES.layer.strength
    ),
    seed: asControlNumber(
      layer.seed,
      `Layer ${index + 1} seed`,
      CONTROL_RANGES.layer.seed
    ),
    colorA: asColor(layer.colorA, `Layer ${index + 1} low color`),
    colorB: asColor(layer.colorB, `Layer ${index + 1} high color`),
    roughness: asControlNumber(
      layer.roughness,
      `Layer ${index + 1} roughness`,
      CONTROL_RANGES.layer.roughness
    ),
    displacement: asControlNumber(
      layer.displacement,
      `Layer ${index + 1} displacement`,
      CONTROL_RANGES.layer.displacement
    )
  };
}

function normalizePhysical(value: unknown): PhysicalSettings {
  const input = value === undefined
    ? {}
    : asRecord(value, 'Physical material settings');
  const merged: Record<string, unknown> = {
    ...DEFAULT_PHYSICAL,
    ...input
  };

  return {
    roughness: asControlNumber(
      merged.roughness,
      'Physical roughness',
      CONTROL_RANGES.physical.roughness
    ),
    metalness: asControlNumber(
      merged.metalness,
      'Physical metalness',
      CONTROL_RANGES.physical.metalness
    ),
    clearcoat: asControlNumber(
      merged.clearcoat,
      'Physical clearcoat',
      CONTROL_RANGES.physical.clearcoat
    ),
    clearcoatRoughness: asControlNumber(
      merged.clearcoatRoughness,
      'Physical clearcoat roughness',
      CONTROL_RANGES.physical.clearcoatRoughness
    ),
    specularIntensity: asControlNumber(
      merged.specularIntensity,
      'Physical specular intensity',
      CONTROL_RANGES.physical.specularIntensity
    ),
    ior: asControlNumber(merged.ior, 'Physical IOR', CONTROL_RANGES.physical.ior),
    sheen: asControlNumber(
      merged.sheen,
      'Physical sheen',
      CONTROL_RANGES.physical.sheen
    ),
    sheenRoughness: asControlNumber(
      merged.sheenRoughness,
      'Physical sheen roughness',
      CONTROL_RANGES.physical.sheenRoughness
    ),
    sheenColor: asColor(merged.sheenColor, 'Physical sheen color'),
    transmission: asControlNumber(
      merged.transmission,
      'Physical transmission',
      CONTROL_RANGES.physical.transmission
    ),
    thickness: asControlNumber(
      merged.thickness,
      'Physical thickness',
      CONTROL_RANGES.physical.thickness
    ),
    attenuationDistance: asControlNumber(
      merged.attenuationDistance,
      'Physical attenuation distance',
      CONTROL_RANGES.physical.attenuationDistance
    ),
    attenuationColor: asColor(merged.attenuationColor, 'Physical attenuation color')
  };
}

export function normalizeProject(value: unknown): ProjectState {
  const project = asRecord(value, 'Project');
  if (project.version !== 1) {
    throw new Error(`Unsupported project version: ${String(project.version)}.`);
  }

  if (!Array.isArray(project.layers) || project.layers.length === 0) {
    throw new Error('Project material must contain at least one layer.');
  }
  if (project.layers.length > MAX_LAYERS) {
    throw new Error(`Project exceeds the ${MAX_LAYERS} layer limit.`);
  }

  const layers = project.layers.map(normalizeLayer);
  const ids = new Set(layers.map((layer) => layer.id));
  if (ids.size !== layers.length) {
    throw new Error('Project contains duplicate layer ids.');
  }

  const requestedSelection = project.selectedLayerId;
  const selectedLayerId =
    typeof requestedSelection === 'string' && ids.has(requestedSelection)
      ? requestedSelection
      : layers.at(-1)?.id ?? null;

  const importedAssetName = project.importedAssetName === null || project.importedAssetName === undefined
    ? null
    : normalizeImportedAssetName(project.importedAssetName);

  return {
    version: 1,
    selectedObject: asObjectPreset(project.selectedObject),
    selectedLayerId,
    importedAssetName,
    background: asColor(project.background, 'Background color'),
    wireframe: asBoolean(project.wireframe, 'Wireframe'),
    physical: normalizePhysical(project.physical),
    layers
  };
}
