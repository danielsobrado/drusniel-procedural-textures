import { labConfig } from '../config/labConfig';
import type {
  BlendMode,
  EnvironmentPreset,
  LayerChannel,
  LayerKind,
  ObjectPreset,
  PhysicalSettings
} from '../materials/types';

export const APP_NAME = labConfig.app.name;
export const STORAGE_KEY = labConfig.app.storageKey;
export const LEGACY_STORAGE_KEYS: readonly string[] = labConfig.app.legacyStorageKeys;
export const MAX_LAYERS = labConfig.app.maxLayers;
export const MAX_GROUPS = labConfig.app.maxGroups;
export const HISTORY_LIMIT = labConfig.app.historyLimit;
export const HISTORY_COALESCE_MS = labConfig.app.historyCoalesceMs;
export const AUTOSAVE_DELAY_MS = labConfig.app.autosaveDelayMs;
export const MAX_MODEL_FILE_BYTES = labConfig.app.maxModelFileBytes;
export const MAX_PROJECT_FILE_BYTES = labConfig.app.maxProjectFileBytes;
export const UI_CONFIG = labConfig.ui;
export const CONTROL_RANGES = labConfig.controls;
export const EXPORT_CONFIG = labConfig.export;
export const PERFORMANCE_CONFIG = labConfig.performance;

export const OBJECT_PRESETS: ReadonlyArray<{ id: ObjectPreset; label: string; glyph: string }> =
  labConfig.objects;
export const LAYER_KINDS: ReadonlyArray<{ id: LayerKind; label: string }> =
  labConfig.layerKinds;
export const LAYER_CHANNELS: ReadonlyArray<{ id: LayerChannel; label: string }> =
  labConfig.channels;
export const ENVIRONMENTS: ReadonlyArray<{ id: EnvironmentPreset; label: string }> =
  labConfig.environments;
export const BLEND_MODES: ReadonlyArray<{ id: BlendMode; label: string }> =
  labConfig.blendModes;

export const DEFAULT_PHYSICAL: Readonly<PhysicalSettings> = labConfig.defaults.physical;
export const DEFAULT_BACKGROUND = labConfig.defaults.background;
export const DEFAULT_OBJECT: ObjectPreset = labConfig.defaults.object;
export const DEFAULT_ENVIRONMENT: EnvironmentPreset = labConfig.defaults.environment;
export const RENDERER_CONFIG = labConfig.renderer;
