import { parse } from 'yaml';
import rawConfig from '../../config/structured-pattern.yaml?raw';

export type StructuredPatternKind = 'brick' | 'tile' | 'plank' | 'pebble' | 'roof-tile' | 'fabric';

export interface StructuredPatternConfig {
  projection: {
    sharpness: number;
    portableAverageMix: number;
  };
  displacementGain: Record<StructuredPatternKind, number>;
}

const KINDS: readonly StructuredPatternKind[] = [
  'brick', 'tile', 'plank', 'pebble', 'roof-tile', 'fabric'
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

function parseConfig(value: unknown): StructuredPatternConfig {
  const root = record(value, 'Structured pattern configuration');
  const projection = record(root.projection, 'Structured pattern projection');
  const displacementInput = record(root.displacementGain, 'Structured pattern displacement gains');
  const displacementGain = {} as Record<StructuredPatternKind, number>;

  for (const kind of KINDS) {
    displacementGain[kind] = number(
      displacementInput[kind],
      `Structured pattern ${kind} displacement gain`,
      0,
      1
    );
  }

  return {
    projection: {
      sharpness: number(projection.sharpness, 'Structured pattern projection sharpness', 1, 16),
      portableAverageMix: number(
        projection.portableAverageMix,
        'Structured pattern portable average mix',
        0,
        1
      )
    },
    displacementGain
  };
}

export function isStructuredPatternKind(value: string): value is StructuredPatternKind {
  return KINDS.includes(value as StructuredPatternKind);
}

export const structuredPatternConfig = parseConfig(parse(rawConfig) as unknown);
