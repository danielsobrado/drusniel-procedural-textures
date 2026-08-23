import type { SurfaceGraphDefinition, SurfaceGraphRuntimeLayer } from '../core/graph/SurfaceGraph';
import { lowerSurfaceGraphRuntimeNodes } from '../core/graph/SurfaceGraphRuntimeLowering';
import { normalizeSurfaceGraph } from '../core/graph/SurfaceGraphValidation';
import { DEFAULT_PATTERN_SETTINGS, normalizePatternSettings } from '../core/material/PatternSettings';
import { PTL_MAX_GROUPS, PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import { compileMaterialGraph, materialGraphHasCycle } from './MaterialGraph';
import type { MaterialGroup, MaterialLayer } from './types';

export interface SurfaceGraphCompilation {
  graph: SurfaceGraphDefinition;
  groups: MaterialGroup[];
  layers: MaterialLayer[];
}

const LAYER_KINDS = new Set<MaterialLayer['kind']>([
  'base', 'fbm', 'cellular', 'ridges', 'spots', 'veins', 'gradient', 'vessels', 'wet-film', 'sss',
  'reaction-diffusion', 'erosion', 'sdf', 'pattern'
]);
const CHANNELS = new Set<MaterialLayer['channel']>([
  'surface', 'color', 'roughness', 'height', 'clearcoat', 'sss', 'metallic', 'ao', 'emissive'
]);
const BLENDS = new Set<MaterialLayer['blendMode']>(['normal', 'multiply', 'add', 'screen', 'overlay']);
const HEX = /^#[0-9a-f]{6}$/i;

function color(value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  if (!HEX.test(candidate)) throw new Error(`Surface graph runtime color is invalid: ${candidate}.`);
  return candidate.toLowerCase();
}

function validateUnambiguousGraph(graph: Readonly<SurfaceGraphDefinition>): void {
  const drivenInputs = new Set<string>();
  for (const edge of graph.edges) {
    const input = `${edge.to.nodeId}:${edge.to.port}`;
    if (drivenInputs.has(input)) {
      throw new Error(`Surface graph input ${edge.to.nodeId}.${edge.to.port} has more than one source.`);
    }
    drivenInputs.add(input);
  }

  const outputChannels = new Set<string>();
  for (const output of graph.outputs) {
    if (outputChannels.has(output.channel)) {
      throw new Error(`Surface graph defines output channel ${output.channel} more than once.`);
    }
    outputChannels.add(output.channel);
  }
}

function runtimeLayer(
  graphId: string,
  nodeId: string,
  label: string,
  runtime: Readonly<SurfaceGraphRuntimeLayer>,
  nodeToLayerId: ReadonlyMap<string, string>
): MaterialLayer {
  if (!LAYER_KINDS.has(runtime.kind as MaterialLayer['kind'])) {
    throw new Error(`Surface graph node ${label} uses unsupported runtime generator ${runtime.kind}.`);
  }
  const channel = (runtime.channel ?? 'surface') as MaterialLayer['channel'];
  const blendMode = (runtime.blendMode ?? (runtime.kind === 'base' ? 'normal' : 'overlay')) as MaterialLayer['blendMode'];
  if (!CHANNELS.has(channel)) throw new Error(`Surface graph node ${label} uses unsupported channel ${channel}.`);
  if (!BLENDS.has(blendMode)) throw new Error(`Surface graph node ${label} uses unsupported blend mode ${blendMode}.`);

  const resolve = (source: string | null | undefined): string | null => {
    if (source === null || source === undefined) return null;
    const layerId = nodeToLayerId.get(source);
    if (layerId === undefined) throw new Error(`Surface graph node ${label} references runtime source ${source} without a layer.`);
    return layerId;
  };

  return {
    id: nodeToLayerId.get(nodeId) ?? `${graphId}:${nodeId}`,
    name: label,
    kind: runtime.kind as MaterialLayer['kind'],
    enabled: true,
    blendMode,
    channel,
    opacity: runtime.opacity ?? 1,
    scale: runtime.scale ?? 4,
    strength: runtime.strength ?? 1,
    seed: runtime.seed ?? 17,
    colorA: color(runtime.colorA, '#20252b'),
    colorB: color(runtime.colorB, '#b6c0c8'),
    roughness: runtime.roughness ?? 0,
    displacement: runtime.displacement ?? 0,
    groupId: runtime.groupId ?? null,
    maskSourceLayerId: resolve(runtime.maskFrom),
    structureSourceLayerId: resolve(runtime.structureFrom),
    maskInvert: runtime.maskInvert ?? false,
    maskStrength: runtime.maskStrength ?? 1,
    pattern: runtime.kind === 'pattern'
      ? normalizePatternSettings({ ...DEFAULT_PATTERN_SETTINGS, ...(runtime.pattern ?? {}) })
      : null
  };
}

export function compileSurfaceGraph(value: unknown): SurfaceGraphCompilation {
  const graph = normalizeSurfaceGraph(value);
  validateUnambiguousGraph(graph);
  const runtimeNodes = lowerSurfaceGraphRuntimeNodes(graph).filter((node) => node.runtime !== undefined);
  if (runtimeNodes.length === 0) throw new Error(`Surface graph ${graph.name} does not contain executable material nodes.`);
  if (runtimeNodes.length > PTL_MAX_LAYERS) {
    throw new Error(`Surface graph ${graph.name} compiles to ${runtimeNodes.length} layers; the runtime limit is ${PTL_MAX_LAYERS}.`);
  }
  if (graph.groups.length > PTL_MAX_GROUPS) {
    throw new Error(`Surface graph ${graph.name} uses too many material groups.`);
  }

  const nodeToLayerId = new Map(runtimeNodes.map((node) => [node.id, `${graph.id}:${node.id}`] as const));
  const groups: MaterialGroup[] = graph.groups.map((group) => ({ ...group }));
  const groupIds = new Set(groups.map((group) => group.id));
  const layers = runtimeNodes.map((node) => runtimeLayer(
    graph.id,
    node.id,
    node.label,
    node.runtime!,
    nodeToLayerId
  ));

  for (const layer of layers) {
    if (layer.groupId !== null && !groupIds.has(layer.groupId)) {
      throw new Error(`Surface graph layer ${layer.name} references missing group ${layer.groupId}.`);
    }
  }
  if (materialGraphHasCycle(compileMaterialGraph(layers))) {
    throw new Error(`Surface graph ${graph.name} contains a cyclic runtime material graph.`);
  }
  return { graph, groups, layers };
}
