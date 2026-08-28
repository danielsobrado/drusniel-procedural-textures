import { RUNTIME_GRASS_PATTERN_CONFIG } from './generated/runtimeConfig';

export type PatternKind =
  | 'brick'
  | 'tile'
  | 'plank'
  | 'grass'
  | 'turf'
  | 'pebble'
  | 'roof-tile'
  | 'fabric';

export type StructuredPatternKind = Exclude<PatternKind, 'grass' | 'turf'>;

const STRUCTURED_PATTERN_KINDS: readonly StructuredPatternKind[] = [
  'brick', 'tile', 'plank', 'pebble', 'roof-tile', 'fabric'
];

export function isStructuredPatternKind(value: string): value is StructuredPatternKind {
  return STRUCTURED_PATTERN_KINDS.includes(value as StructuredPatternKind);
}

export interface PatternSettings {
  kind: PatternKind;
  aspect: number;
  gap: number;
  roundness: number;
  jitter: number;
  rotation: number;
  offset: number;
  density: number;
  edgeWear: number;
  bladeLength?: number;
  bladeWidth?: number;
  bladeTaper?: number;
  bladeBend?: number;
  bladeCurvature?: number;
  clumpScale?: number;
  clumpStrength?: number;
  directionality?: number;
  dryness?: number;
  tipFade?: number;
  rootDarkening?: number;
  heightJitter?: number;
  widthJitter?: number;
  leanJitter?: number;
  fiberLength?: number;
  fiberWidth?: number;
  fiberBreakup?: number;
  fiberSoftness?: number;
}

export const DEFAULT_PATTERN_SETTINGS: Readonly<Required<PatternSettings>> = {
  kind: 'brick',
  aspect: 2,
  gap: 0.08,
  roundness: 0.12,
  jitter: 0.08,
  rotation: 0,
  offset: 0.5,
  density: 1,
  edgeWear: 0.08,
  ...RUNTIME_GRASS_PATTERN_CONFIG.defaults,
  ...RUNTIME_GRASS_PATTERN_CONFIG.turfDefaults
};

export const PATTERN_LIMITS = {
  aspect: { min: 0.2, max: 8 },
  gap: { min: 0, max: 0.45 },
  roundness: { min: 0, max: 0.5 },
  jitter: { min: 0, max: 1 },
  rotation: { min: -1, max: 1 },
  offset: { min: 0, max: 1 },
  density: { min: 0.1, max: 4 },
  edgeWear: { min: 0, max: 1 }
} as const;

export const GRASS_PATTERN_LIMITS = RUNTIME_GRASS_PATTERN_CONFIG.limits;
export const TURF_PATTERN_LIMITS = RUNTIME_GRASS_PATTERN_CONFIG.turfLimits;

const KINDS = new Set<PatternKind>([
  'brick', 'tile', 'plank', 'grass', 'turf', 'pebble', 'roof-tile', 'fabric'
]);

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function normalizePatternSettings(value: unknown): PatternSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pattern settings must be an object.');
  }
  const input = value as Record<string, unknown>;
  const kind = input.kind ?? DEFAULT_PATTERN_SETTINGS.kind;
  if (typeof kind !== 'string' || !KINDS.has(kind as PatternKind)) {
    throw new Error(`Unsupported pattern kind: ${String(kind)}.`);
  }
  const baseNumber = (key: keyof typeof PATTERN_LIMITS): number => {
    const range = PATTERN_LIMITS[key];
    return finite(input[key] ?? DEFAULT_PATTERN_SETTINGS[key], `Pattern ${key}`, range.min, range.max);
  };
  const grassNumber = (key: keyof typeof GRASS_PATTERN_LIMITS): number => {
    const range = GRASS_PATTERN_LIMITS[key];
    return finite(input[key] ?? DEFAULT_PATTERN_SETTINGS[key], `Grass pattern ${key}`, range.min, range.max);
  };
  const turfNumber = (key: keyof typeof TURF_PATTERN_LIMITS): number => {
    const range = TURF_PATTERN_LIMITS[key];
    return finite(input[key] ?? DEFAULT_PATTERN_SETTINGS[key], `Turf pattern ${key}`, range.min, range.max);
  };
  return {
    kind: kind as PatternKind,
    aspect: baseNumber('aspect'),
    gap: baseNumber('gap'),
    roundness: baseNumber('roundness'),
    jitter: baseNumber('jitter'),
    rotation: baseNumber('rotation'),
    offset: baseNumber('offset'),
    density: baseNumber('density'),
    edgeWear: baseNumber('edgeWear'),
    bladeLength: grassNumber('bladeLength'),
    bladeWidth: grassNumber('bladeWidth'),
    bladeTaper: grassNumber('bladeTaper'),
    bladeBend: grassNumber('bladeBend'),
    bladeCurvature: grassNumber('bladeCurvature'),
    clumpScale: grassNumber('clumpScale'),
    clumpStrength: grassNumber('clumpStrength'),
    directionality: grassNumber('directionality'),
    dryness: grassNumber('dryness'),
    tipFade: grassNumber('tipFade'),
    rootDarkening: grassNumber('rootDarkening'),
    heightJitter: grassNumber('heightJitter'),
    widthJitter: grassNumber('widthJitter'),
    leanJitter: grassNumber('leanJitter'),
    fiberLength: turfNumber('fiberLength'),
    fiberWidth: turfNumber('fiberWidth'),
    fiberBreakup: turfNumber('fiberBreakup'),
    fiberSoftness: turfNumber('fiberSoftness')
  };
}
