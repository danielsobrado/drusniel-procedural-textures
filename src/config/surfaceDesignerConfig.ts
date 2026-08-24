import { parse } from 'yaml';
import rawConfig from '../../config/surface-designer.yaml?raw';
import type { MicroGeometrySettings } from '../core/material/MicroGeometry';
import type { PatternKind } from '../core/material/PatternSettings';

export interface SurfaceDesignerNumericRange {
  min: number;
  max: number;
  step: number;
}

export interface SurfaceDesignerConfig {
  version: 1;
  patterns: ReadonlyArray<{ id: PatternKind; label: string }>;
  graph: {
    maxVisibleNodes: number;
    maxVisibleEdges: number;
  };
  microGeometry: MicroGeometrySettings & {
    limits: {
      maxEdgeLength: SurfaceDesignerNumericRange;
      iterations: SurfaceDesignerNumericRange;
      maxVertices: SurfaceDesignerNumericRange;
    };
  };
}

const PATTERN_KINDS = new Set<PatternKind>([
  'brick', 'tile', 'plank', 'grass', 'turf', 'pebble', 'roof-tile', 'fabric'
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  const result = number(value, label, min, max);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 80) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function range(value: unknown, label: string, integral = false): SurfaceDesignerNumericRange {
  const input = record(value, label);
  const read = integral ? integer : number;
  const min = read(input.min, `${label}.min`, 0, 1_000_000);
  const max = read(input.max, `${label}.max`, min, 1_000_000);
  if (max <= min) throw new Error(`${label}.max must be greater than min.`);
  const step = read(input.step, `${label}.step`, integral ? 1 : Number.EPSILON, max - min);
  return { min, max, step };
}

function withinRange(value: number, range: Readonly<SurfaceDesignerNumericRange>, label: string): number {
  if (value < range.min || value > range.max) {
    throw new Error(`${label} must be within its configured limits (${range.min} to ${range.max}).`);
  }
  return value;
}

export function normalizeSurfaceDesignerConfig(value: unknown): SurfaceDesignerConfig {
  const root = record(value, 'Surface designer configuration');
  if (root.version !== 1) throw new Error(`Unsupported surface designer config version: ${String(root.version)}.`);

  if (!Array.isArray(root.patterns) || root.patterns.length !== PATTERN_KINDS.size) {
    throw new Error('Surface designer pattern catalog is incomplete.');
  }
  const patterns = root.patterns.map((entry, index) => {
    const input = record(entry, `Pattern ${index + 1}`);
    if (typeof input.id !== 'string' || !PATTERN_KINDS.has(input.id as PatternKind)) {
      throw new Error(`Pattern ${index + 1} has an unsupported id.`);
    }
    return { id: input.id as PatternKind, label: text(input.label, `Pattern ${index + 1} label`) };
  });
  if (new Set(patterns.map((item) => item.id)).size !== PATTERN_KINDS.size) {
    throw new Error('Surface designer pattern catalog contains duplicate ids.');
  }

  const graph = record(root.graph, 'Surface designer graph');
  const micro = record(root.microGeometry, 'Micro geometry');
  const limits = record(micro.limits, 'Micro geometry limits');
  const maxEdgeLengthLimits = range(limits.maxEdgeLength, 'Micro geometry maxEdgeLength limits');
  const iterationsLimits = range(limits.iterations, 'Micro geometry iterations limits', true);
  const maxVerticesLimits = range(limits.maxVertices, 'Micro geometry maxVertices limits', true);
  const maxEdgeLength = number(micro.maxEdgeLength, 'Micro geometry edge length', 0.001, 10);
  const iterations = integer(micro.iterations, 'Micro geometry iterations', 0, 8);
  const maxVertices = integer(micro.maxVertices, 'Micro geometry vertex budget', 1000, 5_000_000);

  return {
    version: 1,
    patterns,
    graph: {
      maxVisibleNodes: integer(graph.maxVisibleNodes, 'Graph visible node limit', 1, 256),
      maxVisibleEdges: integer(graph.maxVisibleEdges, 'Graph visible edge limit', 1, 768)
    },
    microGeometry: {
      enabled: boolean(micro.enabled, 'Micro geometry enabled'),
      maxEdgeLength: withinRange(maxEdgeLength, maxEdgeLengthLimits, 'Micro geometry edge length'),
      iterations: withinRange(iterations, iterationsLimits, 'Micro geometry iterations'),
      maxVertices: withinRange(maxVertices, maxVerticesLimits, 'Micro geometry vertex budget'),
      limits: {
        maxEdgeLength: maxEdgeLengthLimits,
        iterations: iterationsLimits,
        maxVertices: maxVerticesLimits
      }
    }
  };
}

export const SURFACE_DESIGNER_CONFIG = normalizeSurfaceDesignerConfig(parse(rawConfig) as unknown);
export const DEFAULT_MICRO_GEOMETRY: Readonly<MicroGeometrySettings> = {
  enabled: SURFACE_DESIGNER_CONFIG.microGeometry.enabled,
  maxEdgeLength: SURFACE_DESIGNER_CONFIG.microGeometry.maxEdgeLength,
  iterations: SURFACE_DESIGNER_CONFIG.microGeometry.iterations,
  maxVertices: SURFACE_DESIGNER_CONFIG.microGeometry.maxVertices
};
