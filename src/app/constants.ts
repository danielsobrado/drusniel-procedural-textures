import type { BlendMode, LayerKind, ObjectPreset, PhysicalSettings } from '../materials/types';

export const APP_NAME = 'Procedural Texture Lab';
export const STORAGE_KEY = 'procedural-texture-lab.project.v1';
export const MAX_LAYERS = 12;
export const HISTORY_LIMIT = 80;
export const AUTOSAVE_DELAY_MS = 250;

export const OBJECT_PRESETS: ReadonlyArray<{ id: ObjectPreset; label: string; glyph: string }> = [
  { id: 'sphere', label: 'Sphere', glyph: '●' },
  { id: 'icosphere', label: 'Icosphere', glyph: '⬢' },
  { id: 'cube', label: 'Cube', glyph: '■' },
  { id: 'rounded-cube', label: 'Rounded', glyph: '▣' },
  { id: 'torus', label: 'Torus', glyph: '◉' },
  { id: 'plane', label: 'Plane', glyph: '▱' }
];

export const LAYER_KINDS: ReadonlyArray<{ id: LayerKind; label: string }> = [
  { id: 'base', label: 'Base color' },
  { id: 'fbm', label: 'FBM noise' },
  { id: 'cellular', label: 'Cellular' },
  { id: 'ridges', label: 'Ridges' },
  { id: 'spots', label: 'Spots' },
  { id: 'veins', label: 'Veins' },
  { id: 'gradient', label: 'Gradient' }
];

export const BLEND_MODES: ReadonlyArray<{ id: BlendMode; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'add', label: 'Add' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' }
];

export const DEFAULT_PHYSICAL: Readonly<PhysicalSettings> = {
  roughness: 0.34,
  metalness: 0,
  clearcoat: 0.34,
  clearcoatRoughness: 0.18,
  specularIntensity: 0.62,
  ior: 1.42
};

export const DEFAULT_BACKGROUND = '#111318';
export const DEFAULT_OBJECT: ObjectPreset = 'sphere';
