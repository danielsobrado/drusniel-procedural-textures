import { parse } from 'yaml';
import rawConfig from '../../config/grass-pattern.yaml?raw';

export type GrassPatternKey =
  | 'bladeLength'
  | 'bladeWidth'
  | 'bladeTaper'
  | 'bladeBend'
  | 'bladeCurvature'
  | 'clumpScale'
  | 'clumpStrength'
  | 'directionality'
  | 'dryness'
  | 'tipFade'
  | 'rootDarkening'
  | 'heightJitter'
  | 'widthJitter'
  | 'leanJitter';

export type TurfPatternKey =
  | 'fiberLength'
  | 'fiberWidth'
  | 'fiberBreakup'
  | 'fiberSoftness';

export interface GrassPatternConfig {
  defaults: Record<GrassPatternKey, number>;
  turfDefaults: Record<TurfPatternKey, number>;
  limits: Record<GrassPatternKey, { min: number; max: number }>;
  turfLimits: Record<TurfPatternKey, { min: number; max: number }>;
  rendering: {
    geometryDisplacementGain: number;
    triplanarAverageMix: number;
    turfGeometryDisplacementGain: number;
    turfTriplanarAverageMix: number;
  };
}

const GRASS_KEYS: readonly GrassPatternKey[] = [
  'bladeLength', 'bladeWidth', 'bladeTaper', 'bladeBend', 'bladeCurvature',
  'clumpScale', 'clumpStrength', 'directionality', 'dryness', 'tipFade',
  'rootDarkening', 'heightJitter', 'widthJitter', 'leanJitter'
];

const TURF_KEYS: readonly TurfPatternKey[] = [
  'fiberLength', 'fiberWidth', 'fiberBreakup', 'fiberSoftness'
];

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function parseRanges<TKey extends string>(
  keys: readonly TKey[],
  defaultsInput: Record<string, unknown>,
  limitsInput: Record<string, unknown>,
  label: string
): {
  defaults: Record<TKey, number>;
  limits: Record<TKey, { min: number; max: number }>;
} {
  const defaults = {} as Record<TKey, number>;
  const limits = {} as Record<TKey, { min: number; max: number }>;

  for (const key of keys) {
    const limitInput = record(limitsInput[key], `${label} limit ${key}`);
    const min = number(limitInput.min, `${label} ${key} minimum`, -100, 100);
    const max = number(limitInput.max, `${label} ${key} maximum`, min, 100);
    limits[key] = { min, max };
    defaults[key] = number(defaultsInput[key], `${label} ${key} default`, min, max);
  }

  return { defaults, limits };
}

function parseConfig(value: unknown): GrassPatternConfig {
  const root = record(value, 'Grass pattern configuration');
  const grass = parseRanges(
    GRASS_KEYS,
    record(root.defaults, 'Grass pattern defaults'),
    record(root.limits, 'Grass pattern limits'),
    'Grass pattern'
  );
  const turf = parseRanges(
    TURF_KEYS,
    record(root.turfDefaults, 'Turf pattern defaults'),
    record(root.turfLimits, 'Turf pattern limits'),
    'Turf pattern'
  );
  const renderingInput = record(root.rendering, 'Grass pattern rendering');

  return {
    defaults: grass.defaults,
    turfDefaults: turf.defaults,
    limits: grass.limits,
    turfLimits: turf.limits,
    rendering: {
      geometryDisplacementGain: number(
        renderingInput.geometryDisplacementGain,
        'Grass geometry displacement gain',
        0,
        1
      ),
      triplanarAverageMix: number(
        renderingInput.triplanarAverageMix,
        'Grass triplanar average mix',
        0,
        1
      ),
      turfGeometryDisplacementGain: number(
        renderingInput.turfGeometryDisplacementGain,
        'Turf geometry displacement gain',
        0,
        1
      ),
      turfTriplanarAverageMix: number(
        renderingInput.turfTriplanarAverageMix,
        'Turf triplanar average mix',
        0,
        1
      )
    }
  };
}

export const grassPatternConfig = parseConfig(parse(rawConfig) as unknown);
