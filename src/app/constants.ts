import { labConfig } from '../config/labConfig';
import type { BlendMode, LayerKind, ObjectPreset, PhysicalSettings } from '../materials/types';

export const APP_NAME = labConfig.app.name;
export const STORAGE_KEY = labConfig.app.storageKey;
export const MAX_LAYERS = labConfig.app.maxLayers;
export const HISTORY_LIMIT = labConfig.app.historyLimit;
export const HISTORY_COALESCE_MS = labConfig.app.historyCoalesceMs;
export const AUTOSAVE_DELAY_MS = labConfig.app.autosaveDelayMs;
export const UI_CONFIG = labConfig.ui;

export const OBJECT_PRESETS: ReadonlyArray<{ id: ObjectPreset; label: string; glyph: string }> =
  labConfig.objects;

export const LAYER_KINDS: ReadonlyArray<{ id: LayerKind; label: string }> =
  labConfig.layerKinds;

export const BLEND_MODES: ReadonlyArray<{ id: BlendMode; label: string }> =
  labConfig.blendModes;

export const DEFAULT_PHYSICAL: Readonly<PhysicalSettings> = labConfig.defaults.physical;
export const DEFAULT_BACKGROUND = labConfig.defaults.background;
export const DEFAULT_OBJECT: ObjectPreset = labConfig.defaults.object;
export const RENDERER_CONFIG = labConfig.renderer;
