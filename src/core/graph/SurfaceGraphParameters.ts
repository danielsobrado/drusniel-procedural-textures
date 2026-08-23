import type { PatternKind } from '../material/PatternSettings';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphExposedParameter,
  SurfaceGraphNode,
  SurfaceGraphParameterValue,
  SurfaceGraphRuntimeLayer,
  SurfaceRuntimePattern
} from './SurfaceGraph';
import { normalizeSurfaceGraph } from './SurfaceGraphValidation';

export type SurfaceGraphExposedValue = number | string | boolean;

const PATTERN_KINDS = new Set<PatternKind>([
  'brick', 'tile', 'plank', 'grass', 'pebble', 'roof-tile', 'fabric'
]);

function cloneRuntime(runtime: SurfaceGraphRuntimeLayer | undefined): SurfaceGraphRuntimeLayer | undefined {
  if (runtime === undefined) return undefined;
  return {
    ...runtime,
    pattern: runtime.pattern === undefined || runtime.pattern === null
      ? runtime.pattern
      : { ...runtime.pattern }
  };
}

function cloneNode(node: SurfaceGraphNode): SurfaceGraphNode {
  return {
    ...node,
    position: { ...node.position },
    params: { ...node.params },
    runtime: cloneRuntime(node.runtime)
  };
}

function finiteNumber(value: SurfaceGraphExposedValue, binding: Readonly<SurfaceGraphExposedParameter>): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Exposed parameter ${binding.label} requires a finite number.`);
  }
  const min = binding.min ?? Number.NEGATIVE_INFINITY;
  const max = binding.max ?? Number.POSITIVE_INFINITY;
  if (value < min || value > max) {
    throw new Error(`Exposed parameter ${binding.label} must be between ${min} and ${max}.`);
  }
  return value;
}

function validateValue(
  value: SurfaceGraphExposedValue,
  binding: Readonly<SurfaceGraphExposedParameter>
): SurfaceGraphExposedValue {
  if (binding.type === 'float') return finiteNumber(value, binding);
  if (binding.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Exposed parameter ${binding.label} requires a boolean.`);
    return value;
  }
  if (binding.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value)) {
      throw new Error(`Exposed parameter ${binding.label} requires a six-digit hex color.`);
    }
    return value.toLowerCase();
  }
  if (typeof value !== 'string' || binding.options?.includes(value) !== true) {
    throw new Error(`Exposed parameter ${binding.label} requires one of its configured options.`);
  }
  return value;
}

function updatePatternRuntime(
  runtime: SurfaceGraphRuntimeLayer,
  parameter: string,
  value: number
): SurfaceGraphRuntimeLayer {
  if (runtime.kind !== 'pattern') return runtime;
  const pattern: SurfaceRuntimePattern = { ...(runtime.pattern ?? { kind: 'tile' }) };
  if (parameter === 'aspect') pattern.aspect = value;
  else if (parameter === 'gap') pattern.gap = value;
  else if (parameter === 'roundness') pattern.roundness = value;
  else if (parameter === 'jitter') pattern.jitter = value;
  else if (parameter === 'rotation') pattern.rotation = value;
  else if (parameter === 'offset') pattern.offset = value;
  else if (parameter === 'density') pattern.density = value;
  else if (parameter === 'edgeWear') pattern.edgeWear = value;
  else if (parameter === 'xAmount') runtime.scale = Math.max(0.1, Math.min(20, value * 0.55));
  else if (parameter === 'yAmount') runtime.scale = Math.max(0.1, Math.min(20, value * 0.28));
  else if (parameter === 'clump') pattern.jitter = Math.max(0, Math.min(1, 0.35 + value * 0.75));
  runtime.pattern = pattern;
  return runtime;
}

function updateStringRuntime(
  runtime: SurfaceGraphRuntimeLayer,
  parameter: string,
  value: string
): SurfaceGraphRuntimeLayer {
  if (parameter === 'colorA') runtime.colorA = value;
  else if (parameter === 'colorB') runtime.colorB = value;
  else if (parameter === 'channel') runtime.channel = value as NonNullable<SurfaceGraphRuntimeLayer['channel']>;
  else if (parameter === 'blendMode') runtime.blendMode = value as NonNullable<SurfaceGraphRuntimeLayer['blendMode']>;
  else if (
    runtime.kind === 'pattern' &&
    (parameter === 'kind' || parameter === 'patternKind') &&
    PATTERN_KINDS.has(value as PatternKind)
  ) {
    runtime.pattern = { ...(runtime.pattern ?? { kind: 'tile' }), kind: value as PatternKind };
  }
  return runtime;
}

function updateRuntime(
  runtime: SurfaceGraphRuntimeLayer | undefined,
  parameter: string,
  value: SurfaceGraphExposedValue
): SurfaceGraphRuntimeLayer | undefined {
  if (runtime === undefined) return undefined;
  const next = cloneRuntime(runtime)!;
  if (typeof value === 'number') {
    if (parameter === 'scale') next.scale = value;
    else if (parameter === 'roughness') next.roughness = value;
    else if (parameter === 'displacement' || parameter === 'height') next.displacement = value;
    else if (parameter === 'opacity') next.opacity = value;
    else if (parameter === 'strength') next.strength = value;
    else if (parameter === 'seed') next.seed = value;
    else if (parameter === 'maskStrength') next.maskStrength = value;
    else if (parameter === 'amount' || parameter === 'damage') {
      next.opacity = Math.max(0, Math.min(1, 0.05 + value * 0.55));
    }
    return updatePatternRuntime(next, parameter, value);
  }
  if (typeof value === 'boolean') {
    if (parameter === 'maskInvert') next.maskInvert = value;
    return next;
  }
  return updateStringRuntime(next, parameter, value);
}

export function surfaceGraphExposedValue(
  graph: Readonly<SurfaceGraphDefinition>,
  exposedId: string
): SurfaceGraphExposedValue {
  const binding = graph.exposed.find((item) => item.id === exposedId);
  if (binding === undefined) throw new Error(`Unknown exposed surface graph parameter: ${exposedId}.`);
  const node = graph.nodes.find((item) => item.id === binding.nodeId);
  if (node === undefined) throw new Error(`Exposed parameter ${binding.label} references a missing node.`);
  const value = node.params[binding.parameter];
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  return binding.defaultValue;
}

export function setSurfaceGraphExposedValue(
  graph: Readonly<SurfaceGraphDefinition>,
  exposedId: string,
  rawValue: SurfaceGraphExposedValue
): SurfaceGraphDefinition {
  const binding = graph.exposed.find((item) => item.id === exposedId);
  if (binding === undefined) throw new Error(`Unknown exposed surface graph parameter: ${exposedId}.`);
  const value = validateValue(rawValue, binding);
  const nodes = graph.nodes.map((source) => {
    const node = cloneNode(source);
    if (node.id !== binding.nodeId) return node;
    node.params[binding.parameter] = value as SurfaceGraphParameterValue;
    node.runtime = updateRuntime(node.runtime, binding.parameter, value);
    return node;
  });
  return normalizeSurfaceGraph({ ...graph, nodes });
}
