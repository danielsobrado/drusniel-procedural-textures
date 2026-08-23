import {
  labConfig,
  type ControlsConfig,
  type ExportConfig,
  type PerformanceConfig,
  type RendererConfig,
  type UiConfig
} from '../config/labConfig';
import type {
  BlendMode,
  EnvironmentPreset,
  LayerChannel,
  LayerKind,
  ObjectPreset,
  PhysicalSettings,
  SynthesisSettings
} from '../materials/types';

export const APP_NAME = labConfig.app.name;
export const STORAGE_KEY = labConfig.app.storageKey;
export const LEGACY_STORAGE_KEYS: readonly string[] = labConfig.app.legacyStorageKeys;
export const MAX_LAYERS = labConfig.app.maxLayers;
export const MAX_GROUPS = labConfig.app.maxGroups;
export const MAX_GROUP_DEPTH = labConfig.app.maxGroupDepth;
export const MAX_IMPORTED_MESHES = labConfig.app.maxImportedMeshes;
export const MAX_LAYER_NAME_LENGTH = labConfig.app.maxLayerNameLength;
export const MAX_GROUP_NAME_LENGTH = labConfig.app.maxGroupNameLength;
export const MAX_IMPORTED_ASSET_NAME_LENGTH = labConfig.app.maxImportedAssetNameLength;
export const MAX_MESH_LABEL_LENGTH = labConfig.app.maxMeshLabelLength;
export const HISTORY_LIMIT = labConfig.app.historyLimit;
export const HISTORY_COALESCE_MS = labConfig.app.historyCoalesceMs;
export const AUTOSAVE_DELAY_MS = labConfig.app.autosaveDelayMs;
export const MAX_MODEL_FILE_BYTES = labConfig.app.maxModelFileBytes;
export const MAX_PROJECT_FILE_BYTES = labConfig.app.maxProjectFileBytes;
export const UI_CONFIG: UiConfig = labConfig.ui;
export const CONTROL_RANGES: ControlsConfig = labConfig.controls;
export const EXPORT_CONFIG: ExportConfig = labConfig.export;
export const PERFORMANCE_CONFIG: PerformanceConfig = labConfig.performance;

export const OBJECT_PRESETS: ReadonlyArray<{ id: ObjectPreset; label: string; glyph: string }> =
  labConfig.objects;
export const LAYER_KINDS: ReadonlyArray<{ id: LayerKind; label: string }> = [
  ...labConfig.layerKinds,
  { id: 'pattern', label: 'Pattern / sampler' }
];
export const LAYER_CHANNELS: ReadonlyArray<{ id: LayerChannel; label: string }> =
  labConfig.channels;
export const ENVIRONMENTS: ReadonlyArray<{ id: EnvironmentPreset; label: string }> =
  labConfig.environments;
export const BLEND_MODES: ReadonlyArray<{ id: BlendMode; label: string }> =
  labConfig.blendModes;

export const DEFAULT_PHYSICAL: Readonly<PhysicalSettings> = labConfig.defaults.physical;
export const DEFAULT_SYNTHESIS: Readonly<SynthesisSettings> = labConfig.defaults.synthesis;
export const DEFAULT_BACKGROUND = labConfig.defaults.background;
export const DEFAULT_OBJECT: ObjectPreset = labConfig.defaults.object;
export const DEFAULT_ENVIRONMENT: EnvironmentPreset = labConfig.defaults.environment;
export const RENDERER_CONFIG: RendererConfig = labConfig.renderer;
