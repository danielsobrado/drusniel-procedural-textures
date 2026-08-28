import type {
  SurfaceGraphDefinition,
  SurfaceGraphExposedParameter,
  SurfaceGraphParameterValue
} from './SurfaceGraph';

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function validateValue(
  binding: Readonly<SurfaceGraphExposedParameter>,
  value: SurfaceGraphParameterValue
): void {
  if (binding.type === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Exposed parameter ${binding.label} must reference a numeric node parameter.`);
    }
    if (binding.min !== undefined && value < binding.min) {
      throw new Error(`Exposed parameter ${binding.label} is below its configured minimum.`);
    }
    if (binding.max !== undefined && value > binding.max) {
      throw new Error(`Exposed parameter ${binding.label} is above its configured maximum.`);
    }
    return;
  }

  if (binding.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Exposed parameter ${binding.label} must reference a boolean node parameter.`);
    }
    return;
  }

  if (binding.type === 'color') {
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      throw new Error(`Exposed parameter ${binding.label} must reference a six-digit hex color parameter.`);
    }
    return;
  }

  if (typeof value !== 'string' || binding.options?.includes(value) !== true) {
    throw new Error(`Exposed parameter ${binding.label} must reference one of its configured enum values.`);
  }
}

export function validateSurfaceGraphExposedControls(graph: Readonly<SurfaceGraphDefinition>): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const bindings = new Set<string>();

  for (const binding of graph.exposed) {
    const node = nodes.get(binding.nodeId);
    if (node === undefined) {
      throw new Error(`Exposed parameter ${binding.label} references a missing node.`);
    }
    const key = `${binding.nodeId}:${binding.parameter}`;
    if (bindings.has(key)) {
      throw new Error(`Node parameter ${binding.nodeId}.${binding.parameter} is exposed more than once.`);
    }
    bindings.add(key);

    const value = node.params[binding.parameter];
    if (value === undefined) {
      throw new Error(`Exposed parameter ${binding.label} references missing parameter ${binding.nodeId}.${binding.parameter}.`);
    }
    validateValue(binding, value);
  }

  for (const subgraph of graph.subgraphs) validateSurfaceGraphExposedControls(subgraph);
}
