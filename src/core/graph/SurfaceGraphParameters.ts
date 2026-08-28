import type {
  SurfaceGraphDefinition,
  SurfaceGraphExposedParameter
} from './SurfaceGraph';
import { setSurfaceGraphNodeParameter } from './SurfaceGraphMutation';

export type SurfaceGraphExposedValue = number | string | boolean;

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
  return setSurfaceGraphNodeParameter(graph, binding.nodeId, binding.parameter, value);
}
