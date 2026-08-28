export const TEXTURE_FIELD_CHANNELS = ['r', 'g', 'b', 'a', 'luminance'] as const;
export const TEXTURE_FIELD_MODES = ['replace', 'modulate', 'warp', 'detail'] as const;

export type TextureFieldChannel = typeof TEXTURE_FIELD_CHANNELS[number];
export type TextureFieldMode = typeof TEXTURE_FIELD_MODES[number];

export interface TextureFieldSettings {
  id: string;
  scaleX: number;
  scaleY: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  contrast: number;
  bias: number;
  invert: boolean;
  clamp: boolean;
  channel: TextureFieldChannel;
  mode: TextureFieldMode;
  modeAmount: number;
}

export const DEFAULT_TEXTURE_FIELD_SETTINGS: Readonly<TextureFieldSettings> = Object.freeze({
  id: 'perlin.01',
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  contrast: 1,
  bias: 0,
  invert: false,
  clamp: true,
  channel: 'r',
  mode: 'replace',
  modeAmount: 1
});

const SAFE_TEXTURE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const CHANNELS = new Set<TextureFieldChannel>(TEXTURE_FIELD_CHANNELS);
const MODES = new Set<TextureFieldMode>(TEXTURE_FIELD_MODES);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Texture field settings must be an object.');
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function normalizeTextureFieldSettings(value: unknown): TextureFieldSettings {
  const input = value === undefined || value === null ? {} : record(value);
  const merged = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, ...input } as Record<string, unknown>;
  if (typeof merged.id !== 'string' || !SAFE_TEXTURE_ID.test(merged.id)) {
    throw new Error('Texture field id contains unsupported characters.');
  }
  if (typeof merged.channel !== 'string' || !CHANNELS.has(merged.channel as TextureFieldChannel)) {
    throw new Error(`Unsupported texture field channel: ${String(merged.channel)}.`);
  }
  if (typeof merged.mode !== 'string' || !MODES.has(merged.mode as TextureFieldMode)) {
    throw new Error(`Unsupported texture field mode: ${String(merged.mode)}.`);
  }
  if (typeof merged.invert !== 'boolean' || typeof merged.clamp !== 'boolean') {
    throw new Error('Texture field invert and clamp values must be booleans.');
  }

  return {
    id: merged.id,
    scaleX: finite(merged.scaleX, 'Texture field X scale', 0.01, 128),
    scaleY: finite(merged.scaleY, 'Texture field Y scale', 0.01, 128),
    rotation: finite(merged.rotation, 'Texture field rotation', -Math.PI * 8, Math.PI * 8),
    offsetX: finite(merged.offsetX, 'Texture field X offset', -128, 128),
    offsetY: finite(merged.offsetY, 'Texture field Y offset', -128, 128),
    contrast: finite(merged.contrast, 'Texture field contrast', 0, 8),
    bias: finite(merged.bias, 'Texture field bias', -2, 2),
    invert: merged.invert,
    clamp: merged.clamp,
    channel: merged.channel as TextureFieldChannel,
    mode: merged.mode as TextureFieldMode,
    modeAmount: finite(merged.modeAmount, 'Texture field mode amount', 0, 4)
  };
}
