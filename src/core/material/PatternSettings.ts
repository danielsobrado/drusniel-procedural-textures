export type PatternKind =
  | 'brick'
  | 'tile'
  | 'plank'
  | 'grass'
  | 'pebble'
  | 'roof-tile'
  | 'fabric';

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
}

export const DEFAULT_PATTERN_SETTINGS: Readonly<PatternSettings> = {
  kind: 'brick',
  aspect: 2,
  gap: 0.08,
  roundness: 0.12,
  jitter: 0.08,
  rotation: 0,
  offset: 0.5,
  density: 1,
  edgeWear: 0.08
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

const KINDS = new Set<PatternKind>([
  'brick', 'tile', 'plank', 'grass', 'pebble', 'roof-tile', 'fabric'
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
  const number = (key: keyof typeof PATTERN_LIMITS): number => {
    const range = PATTERN_LIMITS[key];
    return finite(input[key] ?? DEFAULT_PATTERN_SETTINGS[key], `Pattern ${key}`, range.min, range.max);
  };
  return {
    kind: kind as PatternKind,
    aspect: number('aspect'),
    gap: number('gap'),
    roundness: number('roundness'),
    jitter: number('jitter'),
    rotation: number('rotation'),
    offset: number('offset'),
    density: number('density'),
    edgeWear: number('edgeWear')
  };
}
