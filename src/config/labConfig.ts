import { parse } from 'yaml';
import rawConfig from '../../config/lab.yaml?raw';
import type { FixedQualityTier, QualityTier, QualityTierSettings } from '../engine/Quality';
import type {
  BlendMode,
  EnvironmentPreset,
  LayerChannel,
  LayerKind,
  ObjectPreset,
  PhysicalSettings,
  SynthesisSettings
} from '../materials/types';

export interface CatalogItem<T extends string> {
  id: T;
  label: string;
}

export interface ObjectCatalogItem extends CatalogItem<ObjectPreset> {
  glyph: string;
}

export interface NumericControlRange {
  min: number;
  max: number;
  step: number;
}

export type LayerControlKey =
  | 'opacity'
  | 'scale'
  | 'strength'
  | 'seed'
  | 'roughness'
  | 'displacement'
  | 'maskStrength'
  | 'maskThreshold'
  | 'maskSoftness'
  | 'maskBreakup';

export type PhysicalControlKey = Exclude<keyof PhysicalSettings, 'sheenColor' | 'attenuationColor'>;
export type SynthesisControlKey = keyof SynthesisSettings;

export interface ControlsConfig {
  layer: Record<LayerControlKey, NumericControlRange>;
  group: { opacity: NumericControlRange };
  physical: Record<PhysicalControlKey, NumericControlRange>;
  synthesis: Record<SynthesisControlKey, NumericControlRange>;
}

export interface UiConfig {
  longPressDelayMs: number;
  longPressMoveTolerancePx: number;
  radialClickMoveTolerancePx: number;
  radialRadiusPx: number;
  radialEdgePaddingPx: number;
  toastInfoMs: number;
  toastErrorMs: number;
  idleWorkTimeoutMs: number;
  frameBudgetMs: number;
}

export interface RendererConfig {
  maxPixelRatio: number;
  cameraFov: number;
  cameraNear: number;
  cameraFar: number;
  cameraPosition: [number, number, number];
  minDistance: number;
  maxDistance: number;
  toneMappingExposure: number;
  shadowBias: number;
  shadowNormalBias: number;
  displacedNormalStrength: number;
  sssLightDirection: [number, number, number];
  sssBackscatterStrength: number;
  sssThicknessScale: number;
}

export interface ExportConfig {
  texturePaddingPx: number;
  thumbnailSize: number;
  textureFileStem: string;
  glbFileName: string;
  automaticUvPacking: boolean;
  sharedAtlas: boolean;
  bakeStaticDisplacement: boolean;
  minAtlasTileSize: number;
}

export interface PerformanceConfig {
  defaultTier: QualityTier;
  autoMobileTier: FixedQualityTier;
  autoDesktopTier: FixedQualityTier;
  sampleIntervalMs: number;
  tiers: Record<FixedQualityTier, QualityTierSettings>;
}

export interface LabConfig {
  app: {
    name: string;
    storageKey: string;
    legacyStorageKeys: string[];
    maxLayers: number;
    maxGroups: number;
    maxGroupDepth: number;
    maxImportedMeshes: number;
    maxLayerNameLength: number;
    maxGroupNameLength: number;
    maxImportedAssetNameLength: number;
    maxMeshLabelLength: number;
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
    synthesis: SynthesisSettings;
  };
  objects: ObjectCatalogItem[];
  layerKinds: CatalogItem<LayerKind>[];
  channels: CatalogItem<LayerChannel>[];
  environments: CatalogItem<EnvironmentPreset>[];
  blendModes: CatalogItem<BlendMode>[];
  export: ExportConfig;
  performance: PerformanceConfig;
  renderer: RendererConfig;
}

const OBJECT_IDS: readonly ObjectPreset[] = [
  'sphere',
  'icosphere',
  'cube',
  'rounded-cube',
  'torus',
  'plane',
  'cylinder',
  'cone',
  'capsule',
  'octahedron',
  'dodecahedron',
  'torus-knot'
];
const LAYER_KIND_IDS: readonly LayerKind[] = [
  'base', 'fbm', 'cellular', 'ridges', 'spots', 'veins', 'gradient', 'vessels', 'wet-film', 'sss',
  'reaction-diffusion', 'erosion', 'sdf'
];
const CHANNEL_IDS: readonly LayerChannel[] = [
  'surface', 'color', 'roughness', 'height', 'clearcoat', 'sss', 'metallic', 'ao', 'emissive'
];
const ENVIRONMENT_IDS: readonly EnvironmentPreset[] = ['studio', 'warm', 'cool', 'night', 'custom'];
const BLEND_MODE_IDS: readonly BlendMode[] = ['normal', 'multiply', 'add', 'screen', 'overlay'];
const FIXED_QUALITY_TIER_IDS: readonly FixedQualityTier[] = ['mobile', 'balanced', 'high', 'ultra'];
const LAYER_CONTROL_KEYS: readonly LayerControlKey[] = [
  'opacity', 'scale', 'strength', 'seed', 'roughness', 'displacement', 'maskStrength',
  'maskThreshold', 'maskSoftness', 'maskBreakup'
];
const PHYSICAL_CONTROL_KEYS: readonly PhysicalControlKey[] = [
  'roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'specularIntensity',
  'ior', 'sheen', 'sheenRoughness', 'transmission', 'thickness', 'attenuationDistance'
];
const SYNTHESIS_CONTROL_KEYS: readonly SynthesisControlKey[] = [
  'age', 'weathering', 'gravity', 'macro', 'meso', 'micro', 'variation', 'stochasticTiling'
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]*$/i;

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
  if (new Set(values).size !== values.length) throw new Error(`Configuration value ${name} contains duplicates.`);
  return values;
}

function asColor(value: unknown, name: string): string {
  const color = asString(value, name, 7);
  if (!HEX_COLOR.test(color)) throw new Error(`Invalid configuration color: ${name}.`);
  return color.toLowerCase();
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Configuration value ${name} must be a boolean.`);
  return value;
}

function asNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid configuration value: ${name}.`);
  }
  return value;
}

function asInteger(value: unknown, name: string, min: number, max: number): number {
  const parsed = asNumber(value, name, min, max);
  if (!Number.isInteger(parsed)) throw new Error(`Configuration value ${name} must be an integer.`);
  return parsed;
}

function asPowerOfTwo(value: unknown, name: string, min: number, max: number): number {
  const parsed = asInteger(value, name, min, max);
  if ((parsed & (parsed - 1)) !== 0) throw new Error(`Configuration value ${name} must be a power of two.`);
  return parsed;
}

function asFilename(value: unknown, name: string, extension?: string): string {
  const filename = asString(value, name, 128);
  if (!SAFE_FILENAME.test(filename) || (extension !== undefined && !filename.toLowerCase().endsWith(extension))) {
    throw new Error(`Invalid configuration filename: ${name}.`);
  }
  return filename;
}

function asFixedQualityTier(value: unknown, name: string): FixedQualityTier {
  if (FIXED_QUALITY_TIER_IDS.includes(value as FixedQualityTier)) return value as FixedQualityTier;
  throw new Error(`Invalid configuration fixed quality tier: ${name}.`);
}

function asQualityTier(value: unknown, name: string): QualityTier {
  return value === 'auto' ? 'auto' : asFixedQualityTier(value, name);
}

function parseVector3(value: unknown, name: string, min: number, max: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} must contain exactly three numbers.`);
  return [
    asNumber(value[0], `${name}[0]`, min, max),
    asNumber(value[1], `${name}[1]`, min, max),
    asNumber(value[2], `${name}[2]`, min, max)
  ];
}

function parseControlRange(value: unknown, name: string): NumericControlRange {
  const range = asRecord(value, name);
  const min = asNumber(range.min, `${name}.min`, -1_000_000, 1_000_000);
  const max = asNumber(range.max, `${name}.max`, -1_000_000, 1_000_000);
  if (max <= min) throw new Error(`Configuration range ${name} must have max greater than min.`);
  const step = asNumber(range.step, `${name}.step`, 1e-9, 1_000_000);
  if (step > max - min) throw new Error(`Configuration range ${name}.step cannot exceed its span.`);
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
    if (!supported.has(key)) throw new Error(`Unsupported configuration control: ${name}.${key}.`);
  }
  const result = {} as Record<T, NumericControlRange>;
  for (const key of keys) result[key] = parseControlRange(group[key], `${name}.${key}`);
  return result;
}

function parseControls(value: unknown): ControlsConfig {
  const controls = asRecord(value, 'controls');
  return {
    layer: parseControlGroup(controls.layer, LAYER_CONTROL_KEYS, 'controls.layer'),
    group: parseControlGroup(controls.group, ['opacity'] as const, 'controls.group'),
    physical: parseControlGroup(controls.physical, PHYSICAL_CONTROL_KEYS, 'controls.physical'),
    synthesis: parseControlGroup(controls.synthesis, SYNTHESIS_CONTROL_KEYS, 'controls.synthesis')
  };
}

function assertExactCatalog<T extends string>(values: readonly T[], expected: readonly T[], name: string): void {
  const unique = new Set(values);
  if (unique.size !== values.length || values.length !== expected.length) {
    throw new Error(`Configuration catalog ${name} must contain each supported id exactly once.`);
  }
  for (const id of expected) if (!unique.has(id)) throw new Error(`Configuration catalog ${name} is missing ${id}.`);
}

function parseCatalog<T extends string>(value: unknown, expected: readonly T[], name: string): CatalogItem<T>[] {
  if (!Array.isArray(value)) throw new Error(`Configuration ${name} must be an array.`);
  const supported = new Set<string>(expected);
  const items = value.map((item, index) => {
    const record = asRecord(item, `${name}[${index}]`);
    const id = asString(record.id, `${name}[${index}].id`) as T;
    if (!supported.has(id)) throw new Error(`Unsupported ${name} id in configuration: ${id}.`);
    return { id, label: asString(record.label, `${name}[${index}].label`, 64) };
  });
  assertExactCatalog(items.map((item) => item.id), expected, name);
  return items;
}

function parseObjects(value: unknown): ObjectCatalogItem[] {
  if (!Array.isArray(value)) throw new Error('Configuration objects must be an array.');
  const supported = new Set<string>(OBJECT_IDS);
  const objects = value.map((item, index) => {
    const record = asRecord(item, `objects[${index}]`);
    const id = asString(record.id, `objects[${index}].id`) as ObjectPreset;
    if (!supported.has(id)) throw new Error(`Unsupported object id in configuration: ${id}.`);
    return {
      id,
      label: asString(record.label, `objects[${index}].label`, 64),
      glyph: asString(record.glyph, `objects[${index}].glyph`, 16)
    };
  });
  assertExactCatalog(objects.map((item) => item.id), OBJECT_IDS, 'objects');
  return objects;
}

function parsePhysical(value: unknown, ranges: ControlsConfig['physical']): PhysicalSettings {
  const physical = asRecord(value, 'defaults.physical');
  const number = (key: PhysicalControlKey): number => asNumber(
    physical[key], `defaults.physical.${key}`, ranges[key].min, ranges[key].max
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

function parseSynthesis(value: unknown, ranges: ControlsConfig['synthesis']): SynthesisSettings {
  const synthesis = asRecord(value, 'defaults.synthesis');
  const result = {} as SynthesisSettings;
  for (const key of SYNTHESIS_CONTROL_KEYS) {
    result[key] = asNumber(synthesis[key], `defaults.synthesis.${key}`, ranges[key].min, ranges[key].max);
  }
  return result;
}

function parseUi(value: unknown): UiConfig {
  const ui = asRecord(value, 'ui');
  return {
    longPressDelayMs: asInteger(ui.longPressDelayMs, 'ui.longPressDelayMs', 100, 5000),
    longPressMoveTolerancePx: asNumber(ui.longPressMoveTolerancePx, 'ui.longPressMoveTolerancePx', 1, 100),
    radialClickMoveTolerancePx: asNumber(ui.radialClickMoveTolerancePx, 'ui.radialClickMoveTolerancePx', 1, 100),
    radialRadiusPx: asNumber(ui.radialRadiusPx, 'ui.radialRadiusPx', 40, 300),
    radialEdgePaddingPx: asNumber(ui.radialEdgePaddingPx, 'ui.radialEdgePaddingPx', 20, 200),
    toastInfoMs: asInteger(ui.toastInfoMs, 'ui.toastInfoMs', 250, 30_000),
    toastErrorMs: asInteger(ui.toastErrorMs, 'ui.toastErrorMs', 250, 30_000),
    idleWorkTimeoutMs: asInteger(ui.idleWorkTimeoutMs, 'ui.idleWorkTimeoutMs', 50, 10_000),
    frameBudgetMs: asNumber(ui.frameBudgetMs, 'ui.frameBudgetMs', 1, 50)
  };
}

function parseRenderer(value: unknown): RendererConfig {
  const renderer = asRecord(value, 'renderer');
  const cameraNear = asNumber(renderer.cameraNear, 'renderer.cameraNear', 0.0001, 1000);
  const cameraFar = asNumber(renderer.cameraFar, 'renderer.cameraFar', 0.001, 10_000_000);
  const minDistance = asNumber(renderer.minDistance, 'renderer.minDistance', 0.01, 1000);
  const maxDistance = asNumber(renderer.maxDistance, 'renderer.maxDistance', 0.02, 10_000);
  if (cameraFar <= cameraNear || maxDistance <= minDistance) {
    throw new Error('Renderer far/max values must be greater than their near/min values.');
  }
  const lightDirection = parseVector3(renderer.sssLightDirection, 'renderer.sssLightDirection', -1, 1);
  const directionLength = Math.hypot(...lightDirection);
  if (directionLength < 0.001) throw new Error('renderer.sssLightDirection must not be zero length.');
  return {
    maxPixelRatio: asNumber(renderer.maxPixelRatio, 'renderer.maxPixelRatio', 0.5, 4),
    cameraFov: asNumber(renderer.cameraFov, 'renderer.cameraFov', 1, 179),
    cameraNear,
    cameraFar,
    cameraPosition: parseVector3(renderer.cameraPosition, 'renderer.cameraPosition', -10_000, 10_000),
    minDistance,
    maxDistance,
    toneMappingExposure: asNumber(renderer.toneMappingExposure, 'renderer.toneMappingExposure', 0.01, 10),
    shadowBias: asNumber(renderer.shadowBias, 'renderer.shadowBias', -0.01, 0.01),
    shadowNormalBias: asNumber(renderer.shadowNormalBias, 'renderer.shadowNormalBias', 0, 0.5),
    displacedNormalStrength: asNumber(renderer.displacedNormalStrength, 'renderer.displacedNormalStrength', 0, 1),
    sssLightDirection: lightDirection.map((value) => value / directionLength) as [number, number, number],
    sssBackscatterStrength: asNumber(renderer.sssBackscatterStrength, 'renderer.sssBackscatterStrength', 0, 2),
    sssThicknessScale: asNumber(renderer.sssThicknessScale, 'renderer.sssThicknessScale', 0.1, 5)
  };
}

function parseExport(value: unknown): ExportConfig {
  const config = asRecord(value, 'export');
  return {
    texturePaddingPx: asInteger(config.texturePaddingPx, 'export.texturePaddingPx', 0, 64),
    thumbnailSize: asInteger(config.thumbnailSize, 'export.thumbnailSize', 64, 512),
    textureFileStem: asFilename(config.textureFileStem, 'export.textureFileStem'),
    glbFileName: asFilename(config.glbFileName, 'export.glbFileName', '.glb'),
    automaticUvPacking: asBoolean(config.automaticUvPacking, 'export.automaticUvPacking'),
    sharedAtlas: asBoolean(config.sharedAtlas, 'export.sharedAtlas'),
    bakeStaticDisplacement: asBoolean(config.bakeStaticDisplacement, 'export.bakeStaticDisplacement'),
    minAtlasTileSize: asPowerOfTwo(config.minAtlasTileSize, 'export.minAtlasTileSize', 64, 1024)
  };
}

function parsePerformance(value: unknown): PerformanceConfig {
  const performance = asRecord(value, 'performance');
  const tiers = asRecord(performance.tiers, 'performance.tiers');
  const supported = new Set<string>(FIXED_QUALITY_TIER_IDS);
  for (const key of Object.keys(tiers)) if (!supported.has(key)) throw new Error(`Unsupported performance tier: ${key}.`);

  const parsedTiers = {} as Record<FixedQualityTier, QualityTierSettings>;
  for (const id of FIXED_QUALITY_TIER_IDS) {
    const tier = asRecord(tiers[id], `performance.tiers.${id}`);
    parsedTiers[id] = {
      label: asString(tier.label, `performance.tiers.${id}.label`, 32),
      maxPixelRatio: asNumber(tier.maxPixelRatio, `performance.tiers.${id}.maxPixelRatio`, 0.5, 4),
      shadowMapSize: asPowerOfTwo(tier.shadowMapSize, `performance.tiers.${id}.shadowMapSize`, 128, 8192),
      bakeResolution: asPowerOfTwo(tier.bakeResolution, `performance.tiers.${id}.bakeResolution`, 128, 4096),
      maxExportTextureSize: asPowerOfTwo(
        tier.maxExportTextureSize,
        `performance.tiers.${id}.maxExportTextureSize`,
        128,
        4096
      )
    };
  }
  return {
    defaultTier: asQualityTier(performance.defaultTier, 'performance.defaultTier'),
    autoMobileTier: asFixedQualityTier(performance.autoMobileTier, 'performance.autoMobileTier'),
    autoDesktopTier: asFixedQualityTier(performance.autoDesktopTier, 'performance.autoDesktopTier'),
    sampleIntervalMs: asInteger(performance.sampleIntervalMs, 'performance.sampleIntervalMs', 250, 10_000),
    tiers: parsedTiers
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
  if (!objects.some((item) => item.id === defaultObject)) throw new Error(`Unsupported default object: ${defaultObject}.`);
  if (!environments.some((item) => item.id === defaultEnvironment)) {
    throw new Error(`Unsupported default environment: ${defaultEnvironment}.`);
  }

  const storageKey = asString(app.storageKey, 'app.storageKey');
  const legacyStorageKeys = asStringArray(app.legacyStorageKeys ?? [], 'app.legacyStorageKeys');
  if (legacyStorageKeys.includes(storageKey)) throw new Error('app.legacyStorageKeys cannot contain app.storageKey.');

  return {
    app: {
      name: asString(app.name, 'app.name'),
      storageKey,
      legacyStorageKeys,
      maxLayers: asInteger(app.maxLayers, 'app.maxLayers', 1, 32),
      maxGroups: asInteger(app.maxGroups, 'app.maxGroups', 0, 32),
      maxGroupDepth: asInteger(app.maxGroupDepth, 'app.maxGroupDepth', 1, 16),
      maxImportedMeshes: asInteger(app.maxImportedMeshes, 'app.maxImportedMeshes', 1, 100_000),
      maxLayerNameLength: asInteger(app.maxLayerNameLength, 'app.maxLayerNameLength', 1, 1024),
      maxGroupNameLength: asInteger(app.maxGroupNameLength, 'app.maxGroupNameLength', 1, 1024),
      maxImportedAssetNameLength: asInteger(app.maxImportedAssetNameLength, 'app.maxImportedAssetNameLength', 1, 4096),
      maxMeshLabelLength: asInteger(app.maxMeshLabelLength, 'app.maxMeshLabelLength', 1, 4096),
      historyLimit: asInteger(app.historyLimit, 'app.historyLimit', 1, 1000),
      historyCoalesceMs: asInteger(app.historyCoalesceMs, 'app.historyCoalesceMs', 0, 5000),
      autosaveDelayMs: asInteger(app.autosaveDelayMs, 'app.autosaveDelayMs', 0, 60_000),
      maxModelFileBytes: asInteger(app.maxModelFileBytes, 'app.maxModelFileBytes', 1_048_576, 2_147_483_648),
      maxProjectFileBytes: asInteger(app.maxProjectFileBytes, 'app.maxProjectFileBytes', 1024, 67_108_864)
    },
    ui: parseUi(root.ui),
    controls,
    defaults: {
      background: asColor(defaults.background, 'defaults.background'),
      object: defaultObject,
      environment: defaultEnvironment,
      physical: parsePhysical(defaults.physical, controls.physical),
      synthesis: parseSynthesis(defaults.synthesis, controls.synthesis)
    },
    objects,
    layerKinds,
    channels,
    environments,
    blendModes,
    export: parseExport(root.export),
    performance: parsePerformance(root.performance),
    renderer: parseRenderer(root.renderer)
  };
}

export const labConfig = parseConfig(parse(rawConfig) as unknown);
