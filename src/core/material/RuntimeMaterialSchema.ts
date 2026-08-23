import { compileMaterialGraph, materialGraphHasCycle } from '../../materials/MaterialGraph';
import type {
  BlendMode,
  LayerChannel,
  LayerKind,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from '../../materials/types';
import { DEFAULT_PATTERN_SETTINGS, normalizePatternSettings } from './PatternSettings';
import {
  PTL_DEFAULT_PHYSICAL,
  PTL_DEFAULT_SYNTHESIS,
  PTL_GROUP_LIMITS,
  PTL_LAYER_LIMITS,
  PTL_MAX_GROUP_DEPTH,
  PTL_MAX_GROUP_NAME_LENGTH,
  PTL_MAX_GROUPS,
  PTL_MAX_LAYER_NAME_LENGTH,
  PTL_MAX_LAYERS,
  PTL_PHYSICAL_LIMITS,
  PTL_SYNTHESIS_LIMITS
} from './runtimeDefaults';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const LAYER_KINDS = new Set<LayerKind>([
  'base', 'fbm', 'cellular', 'ridges', 'spots', 'veins', 'gradient', 'vessels', 'wet-film', 'sss',
  'reaction-diffusion', 'erosion', 'sdf', 'pattern'
]);
const BLEND_MODES = new Set<BlendMode>(['normal', 'multiply', 'add', 'screen', 'overlay']);
const CHANNELS = new Set<LayerChannel>([
  'surface', 'color', 'roughness', 'height', 'clearcoat', 'sss', 'metallic', 'ao', 'emissive'
]);

interface MaterialDefinition {
  physical: PhysicalSettings;
  synthesis: SynthesisSettings;
  groups: MaterialGroup[];
  layers: MaterialLayer[];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string, maxLength: number, allowEmpty: boolean): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength || (!allowEmpty && value.length === 0)) {
    const minimum = allowEmpty ? '0' : '1';
    throw new Error(`${label} must contain between ${minimum} and ${maxLength} entries.`);
  }
  return value;
}

function string(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label} must be a string up to ${maxLength} characters.`);
  return value;
}

function id(value: unknown, label: string): string {
  const result = string(value, label, 128);
  if (!SAFE_ID.test(result)) throw new Error(`${label} contains unsupported characters.`);
  return result;
}

function nullableId(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : id(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function color(value: unknown, label: string): string {
  const result = string(value, label, 7);
  if (!HEX_COLOR.test(result)) throw new Error(`${label} must be a six-digit hexadecimal color.`);
  return result.toLowerCase();
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, label: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) throw new Error(`${label} is unsupported.`);
  return value as T;
}

function normalizeLayer(value: unknown, index: number): MaterialLayer {
  const input = asRecord(value, `Layer ${index + 1}`);
  const kind = enumValue(input.kind, LAYER_KINDS, `Layer ${index + 1} generator`);
  return {
    id: id(input.id, `Layer ${index + 1} id`),
    name: string(input.name, `Layer ${index + 1} name`, PTL_MAX_LAYER_NAME_LENGTH),
    kind,
    enabled: boolean(input.enabled, `Layer ${index + 1} enabled`),
    blendMode: enumValue(input.blendMode, BLEND_MODES, `Layer ${index + 1} blend mode`),
    channel: enumValue(input.channel ?? 'surface', CHANNELS, `Layer ${index + 1} output channel`),
    opacity: finite(input.opacity, `Layer ${index + 1} opacity`, PTL_LAYER_LIMITS.opacity.min, PTL_LAYER_LIMITS.opacity.max),
    scale: finite(input.scale, `Layer ${index + 1} scale`, PTL_LAYER_LIMITS.scale.min, PTL_LAYER_LIMITS.scale.max),
    strength: finite(input.strength, `Layer ${index + 1} strength`, PTL_LAYER_LIMITS.strength.min, PTL_LAYER_LIMITS.strength.max),
    seed: finite(input.seed, `Layer ${index + 1} seed`, PTL_LAYER_LIMITS.seed.min, PTL_LAYER_LIMITS.seed.max),
    colorA: color(input.colorA, `Layer ${index + 1} low color`),
    colorB: color(input.colorB, `Layer ${index + 1} high color`),
    roughness: finite(input.roughness, `Layer ${index + 1} roughness`, PTL_LAYER_LIMITS.roughness.min, PTL_LAYER_LIMITS.roughness.max),
    displacement: finite(input.displacement, `Layer ${index + 1} displacement`, PTL_LAYER_LIMITS.displacement.min, PTL_LAYER_LIMITS.displacement.max),
    groupId: nullableId(input.groupId, `Layer ${index + 1} group id`),
    maskSourceLayerId: nullableId(input.maskSourceLayerId, `Layer ${index + 1} mask source id`),
    structureSourceLayerId: nullableId(input.structureSourceLayerId, `Layer ${index + 1} structure source id`),
    maskInvert: input.maskInvert === undefined ? false : boolean(input.maskInvert, `Layer ${index + 1} mask invert`),
    maskStrength: input.maskStrength === undefined
      ? 1
      : finite(input.maskStrength, `Layer ${index + 1} mask strength`, PTL_LAYER_LIMITS.maskStrength.min, PTL_LAYER_LIMITS.maskStrength.max),
    pattern: kind === 'pattern'
      ? normalizePatternSettings(input.pattern ?? DEFAULT_PATTERN_SETTINGS)
      : null
  };
}

function normalizeGroup(value: unknown, index: number): MaterialGroup {
  const input = asRecord(value, `Group ${index + 1}`);
  return {
    id: id(input.id, `Group ${index + 1} id`),
    name: string(input.name, `Group ${index + 1} name`, PTL_MAX_GROUP_NAME_LENGTH),
    parentId: nullableId(input.parentId, `Group ${index + 1} parent id`),
    enabled: input.enabled === undefined ? true : boolean(input.enabled, `Group ${index + 1} enabled`),
    opacity: input.opacity === undefined
      ? 1
      : finite(input.opacity, `Group ${index + 1} opacity`, PTL_GROUP_LIMITS.opacity.min, PTL_GROUP_LIMITS.opacity.max)
  };
}

function normalizePhysical(value: unknown): PhysicalSettings {
  const input = value === undefined ? {} : asRecord(value, 'Physical material settings');
  const merged = { ...PTL_DEFAULT_PHYSICAL, ...input } as Record<string, unknown>;
  const number = (key: keyof typeof PTL_PHYSICAL_LIMITS, label: string): number => {
    const range = PTL_PHYSICAL_LIMITS[key];
    return finite(merged[key], label, range.min, range.max);
  };
  return {
    roughness: number('roughness', 'Physical roughness'),
    metalness: number('metalness', 'Physical metalness'),
    clearcoat: number('clearcoat', 'Physical clearcoat'),
    clearcoatRoughness: number('clearcoatRoughness', 'Physical clearcoat roughness'),
    specularIntensity: number('specularIntensity', 'Physical specular intensity'),
    ior: number('ior', 'Physical IOR'),
    sheen: number('sheen', 'Physical sheen'),
    sheenRoughness: number('sheenRoughness', 'Physical sheen roughness'),
    sheenColor: color(merged.sheenColor, 'Physical sheen color'),
    transmission: number('transmission', 'Physical transmission'),
    thickness: number('thickness', 'Physical thickness'),
    attenuationDistance: number('attenuationDistance', 'Physical attenuation distance'),
    attenuationColor: color(merged.attenuationColor, 'Physical attenuation color')
  };
}

function normalizeSynthesis(value: unknown): SynthesisSettings {
  const input = value === undefined ? {} : asRecord(value, 'Material synthesis settings');
  const merged = { ...PTL_DEFAULT_SYNTHESIS, ...input } as Record<string, unknown>;
  const number = (key: keyof typeof PTL_SYNTHESIS_LIMITS, label: string): number => {
    const range = PTL_SYNTHESIS_LIMITS[key];
    return finite(merged[key], label, range.min, range.max);
  };
  return {
    age: number('age', 'Synthesis age'),
    weathering: number('weathering', 'Synthesis weathering'),
    gravity: number('gravity', 'Synthesis gravity'),
    macro: number('macro', 'Synthesis macro scale'),
    meso: number('meso', 'Synthesis meso scale'),
    micro: number('micro', 'Synthesis micro scale'),
    variation: number('variation', 'Synthesis variation'),
    stochasticTiling: number('stochasticTiling', 'Synthesis stochastic tiling')
  };
}

export function normalizeRuntimeMaterialDefinition(value: unknown): MaterialDefinition {
  const input = asRecord(value, 'Material definition');
  const layerValues = asArray(input.layers, 'Material layers', PTL_MAX_LAYERS, false);
  const groupValues = input.groups === undefined ? [] : asArray(input.groups, 'Material groups', PTL_MAX_GROUPS, true);
  const groups = groupValues.map(normalizeGroup);
  const groupIds = new Set(groups.map((group) => group.id));
  if (groupIds.size !== groups.length) throw new Error('Material contains duplicate group ids.');
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    if (group.parentId !== null && !groupsById.has(group.parentId)) throw new Error(`Group ${group.name} references a missing parent group.`);
    let current: MaterialGroup | undefined = group;
    const seen = new Set<string>();
    let depth = 0;
    while (current?.parentId !== null && current?.parentId !== undefined) {
      if (seen.has(current.id)) throw new Error('Material contains a cyclic group hierarchy.');
      seen.add(current.id);
      current = groupsById.get(current.parentId);
      depth += 1;
      if (depth > PTL_MAX_GROUP_DEPTH) throw new Error(`Material groups can be nested at most ${PTL_MAX_GROUP_DEPTH} levels.`);
    }
  }

  const layers = layerValues.map(normalizeLayer);
  const layerIds = new Set(layers.map((layer) => layer.id));
  if (layerIds.size !== layers.length) throw new Error('Material contains duplicate layer ids.');
  for (const layer of layers) {
    if (layer.groupId !== null && !groupIds.has(layer.groupId)) throw new Error(`Layer ${layer.name} references a missing group.`);
    if (layer.maskSourceLayerId !== null) {
      if (layer.maskSourceLayerId === layer.id) throw new Error(`Layer ${layer.name} cannot mask itself.`);
      if (!layerIds.has(layer.maskSourceLayerId)) throw new Error(`Layer ${layer.name} references a missing mask source.`);
    }
    if (layer.structureSourceLayerId !== null) {
      if (layer.structureSourceLayerId === layer.id) throw new Error(`Layer ${layer.name} cannot use itself as a structure source.`);
      if (!layerIds.has(layer.structureSourceLayerId)) throw new Error(`Layer ${layer.name} references a missing structure source.`);
    }
  }
  if (materialGraphHasCycle(compileMaterialGraph(layers))) throw new Error('Material contains a cyclic material graph.');
  return { physical: normalizePhysical(input.physical), synthesis: normalizeSynthesis(input.synthesis), groups, layers };
}
