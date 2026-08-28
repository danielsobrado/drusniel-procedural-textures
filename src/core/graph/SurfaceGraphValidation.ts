import { normalizePatternSettings } from '../material/PatternSettings';
import { normalizeTextureFieldSettings } from '../texture/TextureFieldSettings';
import { SURFACE_GRAPH_NODE_SPEC_BY_KIND } from './SurfaceGraphCatalog';
import {
  surfaceGraphOutputTypesCompatible,
  surfaceGraphPortTypesCompatible
} from './SurfaceGraphCompatibility';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphEdge,
  SurfaceGraphExposedParameter,
  SurfaceGraphGroup,
  SurfaceGraphNode,
  SurfaceGraphOutput,
  SurfaceGraphParameterValue,
  SurfaceGraphPortRef
} from './SurfaceGraph';

type RuntimeBinding = NonNullable<SurfaceGraphNode['runtime']>;
type RuntimeChannel = NonNullable<RuntimeBinding['channel']>;
type RuntimeBlendMode = NonNullable<RuntimeBinding['blendMode']>;

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_GRAPH_NODES = 256;
const MAX_GRAPH_EDGES = 768;
const MAX_GRAPH_OUTPUTS = 10;
const MAX_GRAPH_EXPOSED = 64;
const MAX_GRAPH_GROUPS = 32;
const MAX_GRAPH_SUBGRAPHS = 24;
const MAX_GRAPH_DEPTH = 8;
const MAX_LABEL_LENGTH = 160;
const MAX_PARAM_ARRAY = 64;

const RUNTIME_KINDS = new Set<RuntimeBinding['kind']>([
  'base', 'fbm', 'cellular', 'ridges', 'spots', 'veins', 'gradient', 'vessels', 'wet-film', 'sss',
  'reaction-diffusion', 'erosion', 'sdf', 'pattern'
]);
const RUNTIME_CHANNELS = new Set<RuntimeChannel>([
  'surface', 'color', 'roughness', 'height', 'clearcoat', 'sss', 'metallic', 'ao', 'emissive'
]);
const RUNTIME_BLEND_MODES = new Set<RuntimeBlendMode>([
  'normal', 'multiply', 'add', 'screen', 'overlay'
]);
const OUTPUT_CHANNELS = new Set<SurfaceGraphOutput['channel']>([
  'baseColor', 'roughness', 'metallic', 'normal', 'height', 'ao', 'emissive', 'opacity', 'clearcoat', 'sss'
]);
const EXPOSED_TYPES = new Set<SurfaceGraphExposedParameter['type']>(['float', 'color', 'boolean', 'enum']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${label} contains an invalid id.`);
  return value;
}

function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LABEL_LENGTH) {
    throw new Error(`${name} must contain between 1 and ${MAX_LABEL_LENGTH} characters.`);
  }
  return value;
}

function finite(value: unknown, name: string, min = -1_000_000, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function color(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new Error(`${name} must be a six-digit hex color.`);
  return value.toLowerCase();
}

function enumId<T extends string>(value: unknown, name: string, allowed: ReadonlySet<T>): T {
  const candidate = id(value, name) as T;
  if (!allowed.has(candidate)) throw new Error(`${name} has unsupported value ${candidate}.`);
  return candidate;
}

function paramValue(value: unknown, name: string): SurfaceGraphParameterValue {
  if (typeof value === 'number') return finite(value, name);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (!Array.isArray(value) || value.length > MAX_PARAM_ARRAY) throw new Error(`${name} has an unsupported value.`);
  if (value.every((item) => typeof item === 'number' && Number.isFinite(item))) return value.map(Number);
  if (value.every((item) => typeof item === 'string')) return value.map(String);
  throw new Error(`${name} arrays must contain only finite numbers or only strings.`);
}

function port(value: unknown, name: string): SurfaceGraphPortRef {
  const input = record(value, name);
  return {
    nodeId: id(input.nodeId, `${name} node`),
    port: id(input.port, `${name} port`)
  };
}

function runtime(value: unknown, name: string): SurfaceGraphNode['runtime'] {
  if (value === undefined) return undefined;
  const input = record(value, name);
  const pattern = input.pattern === undefined || input.pattern === null
    ? input.pattern as null | undefined
    : normalizePatternSettings(input.pattern);
  const texture = input.texture === undefined || input.texture === null
    ? input.texture as null | undefined
    : normalizeTextureFieldSettings(input.texture);
  return {
    kind: enumId(input.kind, `${name} kind`, RUNTIME_KINDS),
    channel: input.channel === undefined ? undefined : enumId(input.channel, `${name} channel`, RUNTIME_CHANNELS),
    blendMode: input.blendMode === undefined ? undefined : enumId(input.blendMode, `${name} blend mode`, RUNTIME_BLEND_MODES),
    opacity: input.opacity === undefined ? undefined : finite(input.opacity, `${name} opacity`, 0, 1),
    scale: input.scale === undefined ? undefined : finite(input.scale, `${name} scale`, 0.1, 20),
    strength: input.strength === undefined ? undefined : finite(input.strength, `${name} strength`, 0, 2.5),
    seed: input.seed === undefined ? undefined : finite(input.seed, `${name} seed`, 0, 100),
    colorA: input.colorA === undefined ? undefined : color(input.colorA, `${name} color A`),
    colorB: input.colorB === undefined ? undefined : color(input.colorB, `${name} color B`),
    roughness: input.roughness === undefined ? undefined : finite(input.roughness, `${name} roughness`, -0.5, 0.5),
    displacement: input.displacement === undefined ? undefined : finite(input.displacement, `${name} displacement`, -0.18, 0.18),
    groupId: input.groupId === undefined ? undefined : input.groupId === null ? null : id(input.groupId, `${name} group id`),
    maskFrom: input.maskFrom === undefined ? undefined : input.maskFrom === null ? null : id(input.maskFrom, `${name} mask source`),
    structureFrom: input.structureFrom === undefined ? undefined : input.structureFrom === null ? null : id(input.structureFrom, `${name} structure source`),
    maskInvert: input.maskInvert === undefined ? undefined : boolean(input.maskInvert, `${name} mask invert`),
    maskStrength: input.maskStrength === undefined ? undefined : finite(input.maskStrength, `${name} mask strength`, 0, 1),
    pattern,
    texture
  };
}

function node(value: unknown, index: number): SurfaceGraphNode {
  const input = record(value, `Graph node ${index + 1}`);
  const kind = id(input.kind, `Graph node ${index + 1} kind`) as SurfaceGraphNode['kind'];
  if (!SURFACE_GRAPH_NODE_SPEC_BY_KIND.has(kind)) throw new Error(`Unsupported surface graph node kind: ${kind}.`);
  const paramsInput = input.params === undefined ? {} : record(input.params, `Graph node ${index + 1} parameters`);
  const params = Object.fromEntries(
    Object.entries(paramsInput).map(([key, value]) => [id(key, `Graph node ${index + 1} parameter`), paramValue(value, `Graph node ${index + 1}/${key}`)])
  );
  const position = input.position === undefined ? { x: 0, y: 0 } : record(input.position, `Graph node ${index + 1} position`);
  return {
    id: id(input.id, `Graph node ${index + 1} id`),
    kind,
    label: label(input.label, `Graph node ${index + 1} label`),
    position: {
      x: finite(position.x ?? 0, `Graph node ${index + 1} x`),
      y: finite(position.y ?? 0, `Graph node ${index + 1} y`)
    },
    params,
    runtime: runtime(input.runtime, `Graph node ${index + 1} runtime`),
    subgraphId: input.subgraphId === undefined ? undefined : id(input.subgraphId, `Graph node ${index + 1} subgraph id`)
  };
}

function edge(value: unknown, index: number): SurfaceGraphEdge {
  const input = record(value, `Graph edge ${index + 1}`);
  return { from: port(input.from, `Graph edge ${index + 1} source`), to: port(input.to, `Graph edge ${index + 1} target`) };
}

function output(value: unknown, index: number): SurfaceGraphOutput {
  const input = record(value, `Graph output ${index + 1}`);
  return {
    channel: enumId(input.channel, `Graph output ${index + 1} channel`, OUTPUT_CHANNELS),
    source: port(input.source, `Graph output ${index + 1} source`)
  };
}

function exposed(value: unknown, index: number): SurfaceGraphExposedParameter {
  const input = record(value, `Exposed parameter ${index + 1}`);
  const type = enumId(input.type, `Exposed parameter ${index + 1} type`, EXPOSED_TYPES);
  const result = {
    id: id(input.id, `Exposed parameter ${index + 1} id`),
    label: label(input.label, `Exposed parameter ${index + 1} label`),
    nodeId: id(input.nodeId, `Exposed parameter ${index + 1} node id`),
    parameter: id(input.parameter, `Exposed parameter ${index + 1} parameter`),
    type
  };

  if (type === 'float') {
    const min = input.min === undefined ? undefined : finite(input.min, `Exposed parameter ${index + 1} min`);
    const max = input.max === undefined ? undefined : finite(input.max, `Exposed parameter ${index + 1} max`);
    if (min !== undefined && max !== undefined && max < min) throw new Error(`Exposed parameter ${index + 1} max must be at least min.`);
    const defaultValue = finite(
      input.defaultValue,
      `Exposed parameter ${index + 1} default`,
      min ?? -1_000_000,
      max ?? 1_000_000
    );
    const step = input.step === undefined
      ? undefined
      : finite(input.step, `Exposed parameter ${index + 1} step`, Number.EPSILON, 1_000_000);
    return { ...result, type, defaultValue, min, max, step };
  }

  if (input.min !== undefined || input.max !== undefined || input.step !== undefined) {
    throw new Error(`Exposed parameter ${index + 1} range metadata is only valid for float parameters.`);
  }
  if (type === 'boolean') {
    return { ...result, type, defaultValue: boolean(input.defaultValue, `Exposed parameter ${index + 1} default`) };
  }
  if (type === 'color') {
    return { ...result, type, defaultValue: color(input.defaultValue, `Exposed parameter ${index + 1} default`) };
  }

  if (!Array.isArray(input.options) || input.options.length === 0 || input.options.length > MAX_PARAM_ARRAY) {
    throw new Error(`Exposed parameter ${index + 1} enum options must contain between 1 and ${MAX_PARAM_ARRAY} values.`);
  }
  const options = input.options.map((item, optionIndex) => label(item, `Exposed parameter ${index + 1} option ${optionIndex + 1}`));
  if (new Set(options).size !== options.length) throw new Error(`Exposed parameter ${index + 1} enum options must be unique.`);
  const defaultValue = label(input.defaultValue, `Exposed parameter ${index + 1} default`);
  if (!options.includes(defaultValue)) throw new Error(`Exposed parameter ${index + 1} default must be one of its enum options.`);
  return { ...result, type, defaultValue, options };
}

function group(value: unknown, index: number): SurfaceGraphGroup {
  const input = record(value, `Graph group ${index + 1}`);
  return {
    id: id(input.id, `Graph group ${index + 1} id`),
    name: label(input.name, `Graph group ${index + 1} name`),
    parentId: input.parentId === null || input.parentId === undefined ? null : id(input.parentId, `Graph group ${index + 1} parent id`),
    enabled: input.enabled === undefined ? true : boolean(input.enabled, `Graph group ${index + 1} enabled`),
    opacity: input.opacity === undefined ? 1 : finite(input.opacity, `Graph group ${index + 1} opacity`, 0, 1)
  };
}

function validateAcyclic(nodes: readonly SurfaceGraphNode[], edges: readonly SurfaceGraphEdge[]): void {
  const adjacency = new Map<string, string[]>();
  for (const graphEdge of edges) {
    const next = adjacency.get(graphEdge.from.nodeId) ?? [];
    next.push(graphEdge.to.nodeId);
    adjacency.set(graphEdge.from.nodeId, next);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error('Surface graph contains a cycle.');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) visit(next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const graphNode of nodes) visit(graphNode.id);
}

function validateGroupHierarchy(groups: readonly SurfaceGraphGroup[]): void {
  const byId = new Map(groups.map((item) => [item.id, item] as const));
  for (const group of groups) {
    const seen = new Set<string>();
    let current: SurfaceGraphGroup | undefined = group;
    while (current?.parentId !== null && current?.parentId !== undefined) {
      if (seen.has(current.id)) throw new Error('Surface graph groups contain a parent cycle.');
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
  }
}

function validateEdgePorts(nodes: ReadonlyMap<string, SurfaceGraphNode>, edges: readonly SurfaceGraphEdge[]): void {
  const drivenInputs = new Set<string>();
  for (const item of edges) {
    const source = nodes.get(item.from.nodeId);
    const target = nodes.get(item.to.nodeId);
    if (source === undefined || target === undefined) throw new Error('Surface graph edge references a missing node.');
    const sourceSpec = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(source.kind);
    const targetSpec = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(target.kind);
    const sourcePort = sourceSpec?.outputs.find((portSpec) => portSpec.name === item.from.port);
    const targetPort = targetSpec?.inputs.find((portSpec) => portSpec.name === item.to.port);
    if (sourcePort === undefined) {
      throw new Error(`Surface graph edge references missing output port ${source.id}.${item.from.port}.`);
    }
    if (targetPort === undefined) {
      throw new Error(`Surface graph edge references missing input port ${target.id}.${item.to.port}.`);
    }
    const compatible = target.kind === 'output'
      ? surfaceGraphOutputTypesCompatible(sourcePort.type, targetPort.type)
      : surfaceGraphPortTypesCompatible(sourcePort.type, targetPort.type);
    if (!compatible) {
      throw new Error(
        `Surface graph cannot connect ${source.id}.${item.from.port} (${sourcePort.type}) to ` +
        `${target.id}.${item.to.port} (${targetPort.type}).`
      );
    }
    const inputKey = `${target.id}:${item.to.port}`;
    if (drivenInputs.has(inputKey)) {
      throw new Error(`Surface graph input ${target.id}.${item.to.port} has more than one source.`);
    }
    drivenInputs.add(inputKey);
  }
}

function validateOutputs(
  nodes: ReadonlyMap<string, SurfaceGraphNode>,
  outputs: readonly SurfaceGraphOutput[]
): void {
  const channels = new Set<SurfaceGraphOutput['channel']>();
  for (const item of outputs) {
    if (channels.has(item.channel)) {
      throw new Error(`Surface graph defines output channel ${item.channel} more than once.`);
    }
    channels.add(item.channel);
    if (!nodes.has(item.source.nodeId)) {
      throw new Error(`Graph output ${item.channel} references a missing node.`);
    }
  }
}

export function normalizeSurfaceGraph(value: unknown, depth = 0): SurfaceGraphDefinition {
  if (depth > MAX_GRAPH_DEPTH) throw new Error(`Surface subgraphs can be nested at most ${MAX_GRAPH_DEPTH} levels.`);
  const input = record(value, 'Surface graph');
  if (input.version !== 1) throw new Error(`Unsupported surface graph version: ${String(input.version)}.`);
  if (!Array.isArray(input.nodes) || input.nodes.length === 0 || input.nodes.length > MAX_GRAPH_NODES) {
    throw new Error(`Surface graph must contain between 1 and ${MAX_GRAPH_NODES} nodes.`);
  }
  if (!Array.isArray(input.edges) || input.edges.length > MAX_GRAPH_EDGES) throw new Error(`Surface graph can contain at most ${MAX_GRAPH_EDGES} edges.`);
  const nodes = input.nodes.map(node);
  const nodeIds = new Set(nodes.map((item) => item.id));
  if (nodeIds.size !== nodes.length) throw new Error('Surface graph contains duplicate node ids.');
  const nodesById = new Map(nodes.map((item) => [item.id, item] as const));
  const edges = input.edges.map(edge);
  for (const item of edges) {
    if (!nodeIds.has(item.from.nodeId) || !nodeIds.has(item.to.nodeId)) throw new Error('Surface graph edge references a missing node.');
    if (item.from.nodeId === item.to.nodeId) throw new Error('Surface graph nodes cannot connect to themselves.');
  }
  validateEdgePorts(nodesById, edges);
  validateAcyclic(nodes, edges);

  const outputsInput = input.outputs ?? [];
  if (!Array.isArray(outputsInput) || outputsInput.length > MAX_GRAPH_OUTPUTS) {
    throw new Error(`Surface graph outputs must be an array with at most ${MAX_GRAPH_OUTPUTS} entries.`);
  }
  const outputs = outputsInput.map(output);
  validateOutputs(nodesById, outputs);

  const exposedInput = input.exposed ?? [];
  if (!Array.isArray(exposedInput) || exposedInput.length > MAX_GRAPH_EXPOSED) throw new Error(`Surface graph can expose at most ${MAX_GRAPH_EXPOSED} parameters.`);
  const exposedParameters = exposedInput.map(exposed);
  const exposedIds = new Set(exposedParameters.map((item) => item.id));
  if (exposedIds.size !== exposedParameters.length) throw new Error('Surface graph contains duplicate exposed parameter ids.');
  for (const item of exposedParameters) if (!nodeIds.has(item.nodeId)) throw new Error(`Exposed parameter ${item.label} references a missing node.`);

  const groupsInput = input.groups ?? [];
  if (!Array.isArray(groupsInput) || groupsInput.length > MAX_GRAPH_GROUPS) throw new Error(`Surface graph can contain at most ${MAX_GRAPH_GROUPS} groups.`);
  const groups = groupsInput.map(group);
  const groupIds = new Set(groups.map((item) => item.id));
  if (groupIds.size !== groups.length) throw new Error('Surface graph contains duplicate group ids.');
  for (const item of groups) {
    if (item.parentId !== null && !groupIds.has(item.parentId)) throw new Error(`Graph group ${item.name} references a missing parent.`);
    if (item.parentId === item.id) throw new Error(`Graph group ${item.name} cannot parent itself.`);
  }
  validateGroupHierarchy(groups);

  for (const graphNode of nodes) {
    const binding = graphNode.runtime;
    if (binding === undefined) continue;
    if (binding.groupId !== null && binding.groupId !== undefined && !groupIds.has(binding.groupId)) {
      throw new Error(`Graph node ${graphNode.label} references missing runtime group ${binding.groupId}.`);
    }
    for (const [sourceKind, sourceId] of [['mask', binding.maskFrom], ['structure', binding.structureFrom]] as const) {
      if (sourceId === null || sourceId === undefined) continue;
      if (!nodeIds.has(sourceId)) throw new Error(`Graph node ${graphNode.label} references missing runtime ${sourceKind} source ${sourceId}.`);
      if (sourceId === graphNode.id) throw new Error(`Graph node ${graphNode.label} cannot use itself as a runtime ${sourceKind} source.`);
    }
  }

  const subgraphsInput = input.subgraphs ?? [];
  if (!Array.isArray(subgraphsInput) || subgraphsInput.length > MAX_GRAPH_SUBGRAPHS) throw new Error(`Surface graph can contain at most ${MAX_GRAPH_SUBGRAPHS} subgraphs.`);
  const subgraphs = subgraphsInput.map((item) => normalizeSurfaceGraph(item, depth + 1));
  const subgraphIds = new Set(subgraphs.map((item) => item.id));
  if (subgraphIds.size !== subgraphs.length) throw new Error('Surface graph contains duplicate subgraph ids.');
  for (const item of nodes) {
    if (item.kind === 'subgraph' && (item.subgraphId === undefined || !subgraphIds.has(item.subgraphId))) {
      throw new Error(`Subgraph node ${item.label} references a missing subgraph.`);
    }
  }

  return {
    version: 1,
    id: id(input.id, 'Surface graph id'),
    name: label(input.name, 'Surface graph name'),
    nodes,
    edges,
    outputs,
    exposed: exposedParameters,
    groups,
    subgraphs
  };
}
