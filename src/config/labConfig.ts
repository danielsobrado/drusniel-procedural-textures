import { parse } from 'yaml';
import rawConfig from '../../config/lab.yaml?raw';
import type { BlendMode, LayerKind, ObjectPreset, PhysicalSettings } from '../materials/types';

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
  | 'displacement';

type PhysicalControlKey = Exclude<
  keyof PhysicalSettings,
  'sheenColor' | 'attenuationColor'
>;

interface ControlsConfig {
  layer: Record<LayerControlKey, NumericControlRange>;
  physical: Record<PhysicalControlKey, NumericControlRange>;
}

interface UiConfig {
  longPressDelayMs: number;
  longPressMoveTolerancePx: number;
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
}

interface LabConfig {
  app: {
    name: string;
    storageKey: string;
    maxLayers: number;
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
    physical: PhysicalSettings;
  };
  objects: ObjectCatalogItem[];
  layerKinds: CatalogItem<LayerKind>[];
  blendModes: CatalogItem<BlendMode>[];
  renderer: RendererConfig;
}

const OBJECT_IDS: readonly ObjectPreset[] = [
  'sphere',
  'icosphere',
  'cube',
  'rounded-cube',
  'torus',
  'plane'
];

const LAYER_KIND_IDS: readonly LayerKind[] = [
  'base',
  'fbm',
  'cellular',
  'ridges',
  'spots',
  'veins',
  'gradient'
];

const BLEND_MODE_IDS: readonly BlendMode[] = [
  'normal',
  'multiply',
  'add',
  'screen',
  'overlay'
];

const LAYER_CONTROL_KEYS: readonly LayerControlKey[] = [
  'opacity',
  'scale',
  'strength',
  'seed',
  'roughness',
  'displacement'
];

const PHYSICAL_CONTROL_KEYS: readonly PhysicalControlKey[] = [
  'roughness',
  'metalness',
  'clearcoat',
  'clearcoatRoughness',
  'specularIntensity',
  'ior',
  'sheen',
  'sheenRoughness',
  'transmission',
  'thickness',
  'attenuationDistance'
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

function asColor(value: unknown, name: string): string {
  const color = asString(value, name, 7);
  if (!HEX_COLOR.test(color)) {
    throw new Error(`Invalid configuration color: ${name}.`);
  }
  return color.toLowerCase();
}

function asNumber(value: unknown, name: string, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
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
    physical: parseControlGroup(
      controls.physical,
      PHYSICAL_CONTROL_KEYS,
      'controls.physical'
    )
  };
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

function parseLayerKinds(value: unknown): CatalogItem<LayerKind>[] {
  if (!Array.isArray(value)) {
    throw new Error('Configuration layerKinds must be an array.');
  }

  const supported = new Set<string>(LAYER_KIND_IDS);
  const items = value.map((item, index) => {
    const record = asRecord(item, `layerKinds[${index}]`);
    const id = asString(record.id, `layerKinds[${index}].id`) as LayerKind;
    if (!supported.has(id)) {
      throw new Error(`Unsupported layer kind in configuration: ${id}.`);
    }
    return {
      id,
      label: asString(record.label, `layerKinds[${index}].label`, 64)
    };
  });

  assertExactCatalog(items.map((item) => item.id), LAYER_KIND_IDS, 'layerKinds');
  return items;
}

function parseBlendModes(value: unknown): CatalogItem<BlendMode>[] {
  if (!Array.isArray(value)) {
    throw new Error('Configuration blendModes must be an array.');
  }

  const supported = new Set<string>(BLEND_MODE_IDS);
  const items = value.map((item, index) => {
    const record = asRecord(item, `blendModes[${index}]`);
    const id = asString(record.id, `blendModes[${index}].id`) as BlendMode;
    if (!supported.has(id)) {
      throw new Error(`Unsupported blend mode in configuration: ${id}.`);
    }
    return {
      id,
      label: asString(record.label, `blendModes[${index}].label`, 64)
    };
  });

  assertExactCatalog(items.map((item) => item.id), BLEND_MODE_IDS, 'blendModes');
  return items;
}

function parsePhysical(
  value: unknown,
  ranges: ControlsConfig['physical']
): PhysicalSettings {
  const physical = asRecord(value, 'defaults.physical');
  return {
    roughness: asNumber(
      physical.roughness,
      'defaults.physical.roughness',
      ranges.roughness.min,
      ranges.roughness.max
    ),
    metalness: asNumber(
      physical.metalness,
      'defaults.physical.metalness',
      ranges.metalness.min,
      ranges.metalness.max
    ),
    clearcoat: asNumber(
      physical.clearcoat,
      'defaults.physical.clearcoat',
      ranges.clearcoat.min,
      ranges.clearcoat.max
    ),
    clearcoatRoughness: asNumber(
      physical.clearcoatRoughness,
      'defaults.physical.clearcoatRoughness',
      ranges.clearcoatRoughness.min,
      ranges.clearcoatRoughness.max
    ),
    specularIntensity: asNumber(
      physical.specularIntensity,
      'defaults.physical.specularIntensity',
      ranges.specularIntensity.min,
      ranges.specularIntensity.max
    ),
    ior: asNumber(
      physical.ior,
      'defaults.physical.ior',
      ranges.ior.min,
      ranges.ior.max
    ),
    sheen: asNumber(
      physical.sheen,
      'defaults.physical.sheen',
      ranges.sheen.min,
      ranges.sheen.max
    ),
    sheenRoughness: asNumber(
      physical.sheenRoughness,
      'defaults.physical.sheenRoughness',
      ranges.sheenRoughness.min,
      ranges.sheenRoughness.max
    ),
    sheenColor: asColor(physical.sheenColor, 'defaults.physical.sheenColor'),
    transmission: asNumber(
      physical.transmission,
      'defaults.physical.transmission',
      ranges.transmission.min,
      ranges.transmission.max
    ),
    thickness: asNumber(
      physical.thickness,
      'defaults.physical.thickness',
      ranges.thickness.min,
      ranges.thickness.max
    ),
    attenuationDistance: asNumber(
      physical.attenuationDistance,
      'defaults.physical.attenuationDistance',
      ranges.attenuationDistance.min,
      ranges.attenuationDistance.max
    ),
    attenuationColor: asColor(
      physical.attenuationColor,
      'defaults.physical.attenuationColor'
    )
  };
}

function parseUi(value: unknown): UiConfig {
  const ui = asRecord(value, 'ui');
  return {
    longPressDelayMs: asInteger(ui.longPressDelayMs, 'ui.longPressDelayMs', 100, 5000),
    longPressMoveTolerancePx: asNumber(
      ui.longPressMoveTolerancePx,
      'ui.longPressMoveTolerancePx',
      1,
      100
    ),
    radialRadiusPx: asNumber(ui.radialRadiusPx, 'ui.radialRadiusPx', 40, 300),
    radialEdgePaddingPx: asNumber(
      ui.radialEdgePaddingPx,
      'ui.radialEdgePaddingPx',
      20,
      200
    ),
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
  if (cameraFar <= cameraNear) {
    throw new Error('renderer.cameraFar must be greater than renderer.cameraNear.');
  }

  const minDistance = asNumber(renderer.minDistance, 'renderer.minDistance', 0.01, 1000);
  const maxDistance = asNumber(renderer.maxDistance, 'renderer.maxDistance', 0.02, 10000);
  if (maxDistance <= minDistance) {
    throw new Error('renderer.maxDistance must be greater than renderer.minDistance.');
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
    toneMappingExposure: asNumber(
      renderer.toneMappingExposure,
      'renderer.toneMappingExposure',
      0.01,
      10
    )
  };
}

function parseConfig(value: unknown): LabConfig {
  const root = asRecord(value, 'root');
  const app = asRecord(root.app, 'app');
  const defaults = asRecord(root.defaults, 'defaults');
  const controls = parseControls(root.controls);
  const objects = parseObjects(root.objects);
  const layerKinds = parseLayerKinds(root.layerKinds);
  const blendModes = parseBlendModes(root.blendModes);

  const defaultObject = asString(defaults.object, 'defaults.object') as ObjectPreset;
  if (!objects.some((item) => item.id === defaultObject)) {
    throw new Error(`Unsupported default object in configuration: ${defaultObject}.`);
  }

  return {
    app: {
      name: asString(app.name, 'app.name'),
      storageKey: asString(app.storageKey, 'app.storageKey'),
      maxLayers: asInteger(app.maxLayers, 'app.maxLayers', 1, 32),
      historyLimit: asInteger(app.historyLimit, 'app.historyLimit', 1, 1000),
      historyCoalesceMs: asInteger(app.historyCoalesceMs, 'app.historyCoalesceMs', 0, 5000),
      autosaveDelayMs: asInteger(app.autosaveDelayMs, 'app.autosaveDelayMs', 0, 60000),
      maxModelFileBytes: asInteger(
        app.maxModelFileBytes,
        'app.maxModelFileBytes',
        1048576,
        2147483648
      ),
      maxProjectFileBytes: asInteger(
        app.maxProjectFileBytes,
        'app.maxProjectFileBytes',
        1024,
        67108864
      )
    },
    ui: parseUi(root.ui),
    controls,
    defaults: {
      background: asColor(defaults.background, 'defaults.background'),
      object: defaultObject,
      physical: parsePhysical(defaults.physical, controls.physical)
    },
    objects,
    layerKinds,
    blendModes,
    renderer: parseRenderer(root.renderer)
  };
}

export const labConfig = parseConfig(parse(rawConfig) as unknown);
