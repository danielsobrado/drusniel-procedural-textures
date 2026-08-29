import type { PatternKind } from '../material/PatternSettings';
import {
  TEXTURE_FIELD_MODES,
  type TextureFieldChannel,
  type TextureFieldMode
} from '../texture/TextureFieldSettings';
import { SURFACE_GRAPH_NODE_SPEC_BY_KIND } from './SurfaceGraphCatalog';
import {
  surfaceGraphOutputTypesCompatible,
  surfaceGraphPortTypesCompatible
} from './SurfaceGraphCompatibility';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphEdge,
  SurfaceGraphExposedParameter,
  SurfaceGraphNode,
  SurfaceGraphParameterValue,
  SurfaceGraphPortRef,
  SurfaceGraphPosition,
  SurfaceGraphRuntimeLayer,
  SurfaceRuntimePattern
} from './SurfaceGraph';
import { normalizeSurfaceGraph } from './SurfaceGraphValidation';

const PATTERN_KINDS = new Set<PatternKind>([
  'brick', 'tile', 'plank', 'grass', 'turf', 'pebble', 'roof-tile', 'fabric'
]);
const TEXTURE_MODES = new Set<TextureFieldMode>(TEXTURE_FIELD_MODES);
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

export { surfaceGraphOutputTypesCompatible, surfaceGraphPortTypesCompatible } from './SurfaceGraphCompatibility';

function cloneRuntime(runtime: SurfaceGraphRuntimeLayer | undefined): SurfaceGraphRuntimeLayer | undefined {
  if (runtime === undefined) return undefined;
  return {
    ...runtime,
    pattern: runtime.pattern === undefined || runtime.pattern === null
      ? runtime.pattern
      : { ...runtime.pattern },
    texture: runtime.texture === undefined || runtime.texture === null
      ? runtime.texture
      : { ...runtime.texture }
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

function updateTextureRuntime(
  runtime: SurfaceGraphRuntimeLayer,
  parameter: string,
  value: number
): SurfaceGraphRuntimeLayer {
  const texture = runtime.texture;
  if (texture === undefined || texture === null) return runtime;
  if (parameter === 'scaleX') texture.scaleX = value;
  else if (parameter === 'scaleY') texture.scaleY = value;
  else if (parameter === 'rotation') texture.rotation = value;
  else if (parameter === 'offsetX') texture.offsetX = value;
  else if (parameter === 'offsetY') texture.offsetY = value;
  else if (parameter === 'contrast') texture.contrast = value;
  else if (parameter === 'bias') texture.bias = value;
  else if (parameter === 'modeAmount') texture.modeAmount = value;
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
  } else if (runtime.texture !== undefined && runtime.texture !== null) {
    if (parameter === 'textureId') runtime.texture.id = value;
    else if (parameter === 'sampleChannel') runtime.texture.channel = value as TextureFieldChannel;
    else if (parameter === 'mode' && TEXTURE_MODES.has(value as TextureFieldMode)) {
      runtime.texture.mode = value as TextureFieldMode;
    }
  }
  return runtime;
}

function updateRuntime(
  runtime: SurfaceGraphRuntimeLayer | undefined,
  parameter: string,
  value: SurfaceGraphParameterValue
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
    else if (parameter === 'threshold' || parameter === 'maskThreshold') next.maskThreshold = value;
    else if (parameter === 'softness' || parameter === 'maskSoftness') next.maskSoftness = value;
    else if (parameter === 'breakup' || parameter === 'maskBreakup') next.maskBreakup = value;
    else if (parameter === 'amount' || parameter === 'damage') {
      next.opacity = Math.max(0, Math.min(1, 0.05 + value * 0.55));
    }
    return updateTextureRuntime(updatePatternRuntime(next, parameter, value), parameter, value);
  }
  if (typeof value === 'boolean') {
    if (parameter === 'maskInvert') next.maskInvert = value;
    if (next.texture !== undefined && next.texture !== null) {
      if (parameter === 'invert') next.texture.invert = value;
      else if (parameter === 'clamp') next.texture.clamp = value;
    }
    return next;
  }
  if (typeof value === 'string') return updateStringRuntime(next, parameter, value);
  return next;
}

export function setSurfaceGraphNodeParameter(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  parameter: string,
  value: SurfaceGraphParameterValue
): SurfaceGraphDefinition {
  let found = false;
  const nodes = graph.nodes.map((source) => {
    const node = cloneNode(source);
    if (node.id !== nodeId) return node;
    found = true;
    node.params[parameter] = value;
    node.runtime = updateRuntime(node.runtime, parameter, value);
    return node;
  });
  if (!found) throw new Error(`Unknown surface graph node: ${nodeId}.`);
  return normalizeSurfaceGraph({ ...graph, nodes });
}

export function setSurfaceGraphNodePosition(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  position: SurfaceGraphPosition
): SurfaceGraphDefinition {
  let found = false;
  const nodes = graph.nodes.map((source) => {
    const node = cloneNode(source);
    if (node.id !== nodeId) return node;
    found = true;
    node.position = { ...position };
    return node;
  });
  if (!found) throw new Error(`Unknown surface graph node: ${nodeId}.`);
  return normalizeSurfaceGraph({ ...graph, nodes });
}

export function addSurfaceGraphNode(
  graph: Readonly<SurfaceGraphDefinition>,
  node: SurfaceGraphNode
): SurfaceGraphDefinition {
  if (graph.nodes.some((item) => item.id === node.id)) {
    throw new Error(`Surface graph already contains node ${node.id}.`);
  }
  return normalizeSurfaceGraph({ ...graph, nodes: [...graph.nodes.map(cloneNode), cloneNode(node)] });
}

export function removeSurfaceGraphNode(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string
): SurfaceGraphDefinition {
  const target = graph.nodes.find((node) => node.id === nodeId);
  if (target === undefined) return normalizeSurfaceGraph(graph);
  if (target.kind === 'output') throw new Error('Material output nodes cannot be deleted.');

  const nodes = graph.nodes
    .filter((node) => node.id !== nodeId)
    .map((source) => {
      const node = cloneNode(source);
      if (node.runtime?.maskFrom === nodeId) node.runtime.maskFrom = null;
      if (node.runtime?.structureFrom === nodeId) node.runtime.structureFrom = null;
      return node;
    });
  const edges = graph.edges.filter((edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId);
  const outputs = graph.outputs.filter((output) => output.source.nodeId !== nodeId);
  const exposed = graph.exposed.filter((item) => item.nodeId !== nodeId);
  return normalizeSurfaceGraph({ ...graph, nodes, edges, outputs, exposed });
}

function outputChannel(port: string): SurfaceGraphDefinition['outputs'][number]['channel'] | null {
  if (port === 'baseColor' || port === 'roughness' || port === 'metallic' || port === 'normal' ||
      port === 'height' || port === 'ao' || port === 'emissive' || port === 'opacity' ||
      port === 'clearcoat' || port === 'sss') return port;
  return null;
}

function assertConnection(graph: Readonly<SurfaceGraphDefinition>, from: SurfaceGraphPortRef, to: SurfaceGraphPortRef): void {
  if (from.nodeId === to.nodeId) throw new Error('Surface graph nodes cannot connect to themselves.');
  const source = graph.nodes.find((node) => node.id === from.nodeId);
  const target = graph.nodes.find((node) => node.id === to.nodeId);
  if (source === undefined || target === undefined) throw new Error('Surface graph connection references a missing node.');
  const sourcePort = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(source.kind)?.outputs.find((port) => port.name === from.port);
  const targetPort = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(target.kind)?.inputs.find((port) => port.name === to.port);
  if (sourcePort === undefined || targetPort === undefined) throw new Error('Surface graph connection references a missing port.');
  const compatible = target.kind === 'output'
    ? surfaceGraphOutputTypesCompatible(sourcePort.type, targetPort.type)
    : surfaceGraphPortTypesCompatible(sourcePort.type, targetPort.type);
  if (!compatible) throw new Error(`Cannot connect ${sourcePort.type} to ${targetPort.type}.`);
}

export function connectSurfaceGraphPorts(
  graph: Readonly<SurfaceGraphDefinition>,
  from: SurfaceGraphPortRef,
  to: SurfaceGraphPortRef
): SurfaceGraphDefinition {
  assertConnection(graph, from, to);
  const target = graph.nodes.find((node) => node.id === to.nodeId)!;
  const edges = graph.edges.filter((edge) => !(edge.to.nodeId === to.nodeId && edge.to.port === to.port));
  edges.push({ from: { ...from }, to: { ...to } });

  let outputs = graph.outputs.map((output) => ({ ...output, source: { ...output.source } }));
  if (target.kind === 'output') {
    const channel = outputChannel(to.port);
    if (channel !== null) {
      outputs = outputs.filter((output) => output.channel !== channel);
      outputs.push({ channel, source: { ...from } });
    }
  }
  return normalizeSurfaceGraph({ ...graph, edges, outputs });
}

export function disconnectSurfaceGraphInput(
  graph: Readonly<SurfaceGraphDefinition>,
  to: SurfaceGraphPortRef
): SurfaceGraphDefinition {
  const target = graph.nodes.find((node) => node.id === to.nodeId);
  const edges = graph.edges.filter((edge) => !(edge.to.nodeId === to.nodeId && edge.to.port === to.port));
  let outputs = graph.outputs;
  if (target?.kind === 'output') {
    const channel = outputChannel(to.port);
    if (channel !== null) outputs = outputs.filter((output) => output.channel !== channel);
  }
  return normalizeSurfaceGraph({ ...graph, edges, outputs });
}

export function setSurfaceGraphOutput(
  graph: Readonly<SurfaceGraphDefinition>,
  channel: SurfaceGraphDefinition['outputs'][number]['channel'],
  source: SurfaceGraphPortRef
): SurfaceGraphDefinition {
  const sourceNode = graph.nodes.find((node) => node.id === source.nodeId);
  const sourcePort = sourceNode === undefined
    ? undefined
    : SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(sourceNode.kind)?.outputs.find((port) => port.name === source.port);
  const targetPort = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get('output')?.inputs.find((port) => port.name === channel);
  if (sourcePort === undefined) throw new Error('Surface graph output references a missing source port.');
  if (targetPort === undefined) throw new Error(`Unknown material output channel: ${channel}.`);
  if (!surfaceGraphOutputTypesCompatible(sourcePort.type, targetPort.type)) {
    throw new Error(`Cannot route ${sourcePort.type} to material output ${channel} (${targetPort.type}).`);
  }
  const outputs = graph.outputs.filter((output) => output.channel !== channel);
  outputs.push({ channel, source: { ...source } });
  return normalizeSurfaceGraph({ ...graph, outputs });
}

export function exposeSurfaceGraphNodeParameter(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  parameter: string,
  exposedId: string,
  label: string
): SurfaceGraphDefinition {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (node === undefined) throw new Error(`Unknown surface graph node: ${nodeId}.`);
  const value = node.params[parameter];
  let binding: SurfaceGraphExposedParameter;
  if (typeof value === 'number') {
    binding = { id: exposedId, label, nodeId, parameter, type: 'float', defaultValue: value };
  } else if (typeof value === 'boolean') {
    binding = { id: exposedId, label, nodeId, parameter, type: 'boolean', defaultValue: value };
  } else if (typeof value === 'string' && HEX_COLOR.test(value)) {
    binding = { id: exposedId, label, nodeId, parameter, type: 'color', defaultValue: value.toLowerCase() };
  } else if (parameter === 'mode' && typeof value === 'string' && TEXTURE_MODES.has(value as TextureFieldMode)) {
    binding = {
      id: exposedId,
      label,
      nodeId,
      parameter,
      type: 'enum',
      defaultValue: value,
      options: [...TEXTURE_FIELD_MODES]
    };
  } else {
    throw new Error('Only numeric, boolean, color and supported enum parameters can be exposed directly from the graph editor.');
  }
  const exposed = graph.exposed.filter((item) => item.id !== exposedId && !(item.nodeId === nodeId && item.parameter === parameter));
  exposed.push(binding);
  return normalizeSurfaceGraph({ ...graph, exposed });
}

export function removeSurfaceGraphExposedParameter(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  parameter: string
): SurfaceGraphDefinition {
  const exposed = graph.exposed.filter((item) => !(item.nodeId === nodeId && item.parameter === parameter));
  return normalizeSurfaceGraph({ ...graph, exposed });
}

export function cloneSurfaceGraphEdge(edge: Readonly<SurfaceGraphEdge>): SurfaceGraphEdge {
  return { from: { ...edge.from }, to: { ...edge.to } };
}
