import { parse } from 'yaml';
import rawConfig from '../../config/lab.yaml?raw';
import type {
  BlendMode,
  EnvironmentPreset,
  LayerChannel,
  LayerKind,
  ObjectPreset,
  PhysicalSettings
} from '../materials/types';

interface CatalogItem<T extends string> {
  id: T;
  label: string;
}

interface ObjectCatalogItem extends CatalogItem<ObjectPreset> {
  glyph: string;
}

interface NumericControlRange {
  min: number;
  max: number;
  step: number;
}

type LayerControlKey =
  | 'opacity'
  | 'scale'
  | 'strength'
  | 'seed'
  | 'roughness'
  | 'displacement'
  | 'maskStrength';

type PhysicalControlKey = Exclude<
  keyof PhysicalSettings,
  'sheenColor' | 'attenuationColor'
>;

interface ControlsConfig {
  layer: Record<LayerControlKey, NumericControlRange>;
  group: { opacity: NumericControlRange };
  physical: Record<PhysicalControlKey, NumericControlRange>;
}

interface UiConfig {
  longPressDelayMs: number;
  longPressMoveTolerancePx: number;
  radialClickMoveTolerancePx: number;
  radialRadiusPx: number;
  radialEdgePaddingPx: number;
  toastInfoMs: number;
  toastErrorMs: number;
}

interface RendererConfig {
  maxPixelRatio: number;
  cameraFov: number;
  cameraNear: number;
  cameraFar: number;
  cameraPosition: [number, number, number];
  minDistance: number;
  maxDistance: number;
  toneMappingExposure: number;
  displacedNormalStrength: number;
}

interface LabConfig {
  app: {
    name: string;
    storageKey: string;
    legacyStorageKeys: string[];
    maxLayers: number;
    maxGroups: number;
    historyLimit: number;
    historyCoalesceMs: number;
    autosaveDelayMs: number;
    maxModelFileBytes: number;
    maxProjectFileBytes: number;
  };
  ui: UiConfig;
  controls: ControlsConfig;
  defaults: {
    background: string;
    object: ObjectPreset;
    environment: EnvironmentPreset;
    physical: PhysicalSettings;
  };
  objects: ObjectCatalogItem[];
  layerKinds: CatalogItem<LayerKind>[];
  channels: CatalogItem<LayerChannel>[];
  environments: CatalogItem<EnvironmentPreset>[];
  blendModes: CatalogItem<BlendMode>[];
  renderer: RendererConfig;
}

const OBJECT_IDS: readonly ObjectPreset[] = [
  'sphere', 'icosphere', 'cube', 'rounded-cube', 'torus', 'plane'
];
const LAYER_KIND_IDS: readonly LayerKind[] = [
  'base', 'fbm', 'cellular', 'ridges', 'spots', 'veins', 'gradient',
  'vessels', 'wet-film', 'sss'
];
const CHANNEL_IDS: readonly LayerChannel[] = [
  'surface', 'color', 'roughness', 'height', 'clearcoat', 'sss'
];
const ENVIRONMENT_IDS: readonly EnvironmentPreset[] = [
  'studio', 'warm', 'cool', 'night', 'custom'
];
const BLEND_MODE_IDS: readonly BlendMode[] = [
  'normal', 'multiply', 'add', 'screen', 'overlay'
];
const LAYER_CONTROL_KEYS: readonly LayerControlKey[] = [
  'opacity', 'scale', 'strength', 'seed', 'roughness', 'displacement', 'maskStrength'
];
const PHYSICAL_CONTROL_KEYS: readonly PhysicalControlKey[] = [
  'roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'specularIntensity',
  'ior', 'sheen', 'sheenRoughness', 'transmission', 'thickness', 'attenuationDistance'
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Configuration section ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string, maxLength = 128): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Invalid configuration value: ${name}.`);
  }
  return value;
}

function asStringArray(value: unknown, name: string, maxItems = 16): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`Configuration value ${name} must be an array with at most ${maxItems} entries.`);
  }
  const values = value.map((item, index) => asString(item, `${name}[${index}]`));
  if (new Set(values).size !== values.length) {
    throw new Error(`Configuration value ${name} contains duplicate entries.`);
  }
  return values;
}

function asColor(value: unknown, name: string): string {
  const color = asString(value, name, 7);
  if (!HEX_COLOR.test(color)) {
    throw new Error(`Invalid configuration color: ${name}.`);
  }
  return color.toLowerCase();
}

function asNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid configuration value: ${name}.`);
  }
  return value;
}

function asInteger(value: unknown, name: string, min: number, max: number): number {
  const parsed = asNumber(value, name, min, max);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Configuration value ${name} must be an integer.`);
  }
  return parsed;
}

function parseControlRange(value: unknown, name: string): NumericControlRange {
  const range = asRecord(value, name);
  const min = asNumber(range.min, `${name}.min`, -1000000, 1000000);
  const max = asNumber(range.max, `${name}.max`, -1000000, 1000000);
  if (max <= min) {
    throw new Error(`Configuration range ${name} must have max greater than min.`);
  }
  const step = asNumber(range.step, `${name}.step`, 0.000000001, 1000000);
  if (step > max - min) {
    throw new Error(`Configuration range ${name}.step cannot exceed its span.`);
  }
  return { min, max, step };
}

function parseControlGroup<T extends string>(
  value: unknown,
  keys: readonly T[],
  name: string
): Record<T, NumericControlRange> {
  const group = asRecord(value, name);
  const supported = new Set<string>(keys);
  for (const key of Object.keys(group)) {
    if (!supported.has(key)) {
      throw new Error(`Unsupported configuration control: ${name}.${key}.`);
    }
  }
  const result = {} as Record<T, NumericControlRange>;
  for (const key of keys) {
    result[key] = parseControlRange(group[key], `${name}.${key}`);
  }
  return result;
}

function parseControls(value: unknown): ControlsConfig {
  const controls = asRecord(value, 'controls');
  return {
    layer: parseControlGroup(controls.layer, LAYER_CONTROL_KEYS, 'controls.layer'),
    group: parseControlGroup(controls.group, ['opacity'] as const, 'controls.group'),
    physical: parseControlGroup(controls.physical, PHYSICAL_CONTROL_KEYS, 'controls.physical')
  };
}

function assertExactCatalog<T extends string>(
  values: readonly T[],
  expected: readonly T[],
  name: string
): void {
  const unique = new Set(values);
  if (unique.size !== values.length || values.length !== expected.length) {
    throw new Error(`Configuration catalog ${name} must contain each supported id exactly once.`);
  }
  for (const id of expected) {
    if (!unique.has(id)) {
      throw new Error(`Configuration catalog ${name} is missing ${id}.`);
    }
  }
}

function parseCatalog<T extends string>(
  value: unknown,
  expected: readonly T[],
  name: string
): CatalogItem<T>[] {
  if (!Array.isArray(value)) {
    throw new Error(`Configuration ${name} must be an array.`);
  }
  const supported = new Set<string>(expected);
  const items = value.map((item, index) => {
    const record = asRecord(item, `${name}[${index}]`);
    const id = asString(record.id, `${name}[${index}].id`) as T;
    if (!supported.has(id)) {
      throw new Error(`Unsupported ${name} id in configuration: ${id}.`);
    }
    return {
      id,
      label: asString(record.label, `${name}[${index}].label`, 64)
    };
  });
  assertExactCatalog(items.map((item) => item.id), expected, name);
  return items;
}

function parseObjects(value: unknown): ObjectCatalogItem[] {
  if (!Array.isArray(value)) {
    throw new Error('Configuration objects must be an array.');
  }
  const supported = new Set<string>(OBJECT_IDS);
  const objects = value.map((item, index) => {
    const record = asRecord(item, `objects[${index}]`);
    const id = asString(record.id, `objects[${index}].id`) as ObjectPreset;
    if (!supported.has(id)) {
      throw new Error(`Unsupported object id in configuration: ${id}.`);
    }
    return {
      id,
      label: asString(record.label, `objects[${index}].label`, 64),
      glyph: asString(record.glyph, `objects[${index}].glyph`, 16)
    };
  });
  assertExactCatalog(objects.map((item) => item.id), OBJECT_IDS, 'objects');
  return objects;
}

function parsePhysical(
  value: unknown,
  ranges: ControlsConfig['physical']
): PhysicalSettings {
  const physical = asRecord(value, 'defaults.physical');
  const number = (key: PhysicalControlKey): number => asNumber(
    physical[key],
    `defaults.physical.${key}`,
    ranges[key].min,
    ranges[key].max
  );
  return {
    roughness: number('roughness'),
    metalness: number('metalness'),
    clearcoat: number('clearcoat'),
    clearcoatRoughness: number('clearcoatRoughness'),
    specularIntensity: number('specularIntensity'),
    ior: number('ior'),
    sheen: number('sheen'),
    sheenRoughness: number('sheenRoughness'),
    sheenColor: asColor(physical.sheenColor, 'defaults.physical.sheenColor'),
    transmission: number('transmission'),
    thickness: number('thickness'),
    attenuationDistance: number('attenuationDistance'),
    attenuationColor: asColor(physical.attenuationColor, 'defaults.physical.attenuationColor')
  };
}

function parseUi(value: unknown): UiConfig {
  const ui = asRecord(value, 'ui');
  return {
    longPressDelayMs: asInteger(ui.longPressDelayMs, 'ui.longPressDelayMs', 100, 5000),
    longPressMoveTolerancePx: asNumber(ui.longPressMoveTolerancePx, 'ui.longPressMoveTolerancePx', 1, 100),
    radialClickMoveTolerancePx: asNumber(ui.radialClickMoveTolerancePx, 'ui.radialClickMoveTolerancePx', 1, 100),
    radialRadiusPx: asNumber(ui.radialRadiusPx, 'ui.radialRadiusPx', 40, 300),
    radialEdgePaddingPx: asNumber(ui.radialEdgePaddingPx, 'ui.radialEdgePaddingPx', 20, 200),
    toastInfoMs: asInteger(ui.toastInfoMs, 'ui.toastInfoMs', 250, 30000),
    toastErrorMs: asInteger(ui.toastErrorMs, 'ui.toastErrorMs', 250, 30000)
  };
}

function parseRenderer(value: unknown): RendererConfig {
  const renderer = asRecord(value, 'renderer');
  const position = renderer.cameraPosition;
  if (!Array.isArray(position) || position.length !== 3) {
    throw new Error('renderer.cameraPosition must contain exactly three numbers.');
  }
  const cameraNear = asNumber(renderer.cameraNear, 'renderer.cameraNear', 0.0001, 1000);
  const cameraFar = asNumber(renderer.cameraFar, 'renderer.cameraFar', 0.001, 10000000);
  const minDistance = asNumber(renderer.minDistance, 'renderer.minDistance', 0.01, 1000);
  const maxDistance = asNumber(renderer.maxDistance, 'renderer.maxDistance', 0.02, 10000);
  if (cameraFar <= cameraNear || maxDistance <= minDistance) {
    throw new Error('Renderer far/max values must be greater than their near/min values.');
  }
  return {
    maxPixelRatio: asNumber(renderer.maxPixelRatio, 'renderer.maxPixelRatio', 0.5, 4),
    cameraFov: asNumber(renderer.cameraFov, 'renderer.cameraFov', 1, 179),
    cameraNear,
    cameraFar,
    cameraPosition: [
      asNumber(position[0], 'renderer.cameraPosition[0]', -10000, 10000),
      asNumber(position[1], 'renderer.cameraPosition[1]', -10000, 10000),
      asNumber(position[2], 'renderer.cameraPosition[2]', -10000, 10000)
    ],
    minDistance,
    maxDistance,
    toneMappingExposure: asNumber(renderer.toneMappingExposure, 'renderer.toneMappingExposure', 0.01, 10),
    displacedNormalStrength: asNumber(
      renderer.displacedNormalStrength,
      'renderer.displacedNormalStrength',
      0,
      1
    )
  };
}

function parseConfig(value: unknown): LabConfig {
  const root = asRecord(value, 'root');
  const app = asRecord(root.app, 'app');
  const defaults = asRecord(root.defaults, 'defaults');
  const controls = parseControls(root.controls);
  const objects = parseObjects(root.objects);
  const layerKinds = parseCatalog(root.layerKinds, LAYER_KIND_IDS, 'layerKinds');
  const channels = parseCatalog(root.channels, CHANNEL_IDS, 'channels');
  const environments = parseCatalog(root.environments, ENVIRONMENT_IDS, 'environments');
  const blendModes = parseCatalog(root.blendModes, BLEND_MODE_IDS, 'blendModes');

  const defaultObject = asString(defaults.object, 'defaults.object') as ObjectPreset;
  const defaultEnvironment = asString(defaults.environment, 'defaults.environment') as EnvironmentPreset;
  if (!objects.some((item) => item.id === defaultObject)) {
    throw new Error(`Unsupported default object in configuration: ${defaultObject}.`);
  }
  if (!environments.some((item) => item.id === defaultEnvironment)) {
    throw new Error(`Unsupported default environment in configuration: ${defaultEnvironment}.`);
  }

  const storageKey = asString(app.storageKey, 'app.storageKey');
  const legacyStorageKeys = asStringArray(app.legacyStorageKeys ?? [], 'app.legacyStorageKeys');
  if (legacyStorageKeys.includes(storageKey)) {
    throw new Error('app.legacyStorageKeys cannot contain app.storageKey.');
  }

  return {
    app: {
      name: asString(app.name, 'app.name'),
      storageKey,
      legacyStorageKeys,
      maxLayers: asInteger(app.maxLayers, 'app.maxLayers', 1, 32),
      maxGroups: asInteger(app.maxGroups, 'app.maxGroups', 0, 32),
      historyLimit: asInteger(app.historyLimit, 'app.historyLimit', 1, 1000),
      historyCoalesceMs: asInteger(app.historyCoalesceMs, 'app.historyCoalesceMs', 0, 5000),
      autosaveDelayMs: asInteger(app.autosaveDelayMs, 'app.autosaveDelayMs', 0, 60000),
      maxModelFileBytes: asInteger(app.maxModelFileBytes, 'app.maxModelFileBytes', 1048576, 2147483648),
      maxProjectFileBytes: asInteger(app.maxProjectFileBytes, 'app.maxProjectFileBytes', 1024, 67108864)
    },
    ui: parseUi(root.ui),
    controls,
    defaults: {
      background: asColor(defaults.background, 'defaults.background'),
      object: defaultObject,
      environment: defaultEnvironment,
      physical: parsePhysical(defaults.physical, controls.physical)
    },
    objects,
    layerKinds,
    channels,
    environments,
    blendModes,
    renderer: parseRenderer(root.renderer)
  };
}

export const labConfig = parseConfig(parse(rawConfig) as unknown);
