import type {
  SurfaceGraphDefinition,
  SurfaceGraphNode,
  SurfaceGraphNodeKind,
  SurfaceGraphRuntimeLayer,
  SurfaceRuntimeChannel,
  SurfaceRuntimePattern
} from './SurfaceGraph';

const DEFAULT_COLORS = ['#283038', '#aab4bd'] as const;
const DEFAULT_PATTERN: SurfaceRuntimePattern = {
  kind: 'tile',
  aspect: 1,
  gap: 0.08,
  roundness: 0.12,
  jitter: 0.08,
  rotation: 0,
  offset: 0.5,
  density: 1,
  edgeWear: 0.08
};

const HEIGHT_KINDS = new Set<SurfaceGraphNodeKind>([
  'bevel', 'slope-blur', 'blur', 'non-uniform-blur', 'distance', 'edge-detect', 'curvature',
  'emboss', 'sharpen', 'height-blend', 'height-select', 'warp', 'directional-warp', 'vector-warp',
  'multi-direction-warp', 'swirl', 'slope-warp', 'levels', 'histogram-scan', 'histogram-range',
  'clamp', 'contrast', 'posterize', 'quantize', 'invert', 'transform-2d', 'mirror', 'symmetry',
  'tile', 'polar-transform', 'height-to-normal', 'height-to-curvature', 'height-to-slope',
  'height-to-edge', 'height-to-cavity', 'normal-combine', 'normal-blend', 'normal-rotate'
]);

const BLEND_KIND_TO_MODE: Partial<Record<SurfaceGraphNodeKind, SurfaceGraphRuntimeLayer['blendMode']>> = {
  blend: 'normal',
  min: 'multiply',
  max: 'screen',
  multiply: 'multiply',
  add: 'add',
  subtract: 'overlay',
  overlay: 'overlay',
  screen: 'screen'
};

function numberParam(node: Readonly<SurfaceGraphNode>, key: string, fallback: number): number {
  const value = node.params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringParam(node: Readonly<SurfaceGraphNode>, key: string, fallback: string): string {
  const value = node.params[key];
  return typeof value === 'string' ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function patternKind(node: Readonly<SurfaceGraphNode>): SurfaceRuntimePattern['kind'] {
  const requested = stringParam(node, 'pattern', stringParam(node, 'shape', 'tile'));
  if (requested.includes('brick')) return 'brick';
  if (requested.includes('grass') || requested.includes('blade')) return 'grass';
  if (requested.includes('pebble') || requested.includes('stone') || requested.includes('cobble')) return 'pebble';
  if (requested.includes('roof') || requested.includes('barrel')) return 'roof-tile';
  if (requested.includes('fabric') || requested.includes('weave')) return 'fabric';
  if (requested.includes('plank') || requested.includes('wood')) return 'plank';
  return 'tile';
}

function patternForNode(node: Readonly<SurfaceGraphNode>): SurfaceRuntimePattern {
  return {
    ...DEFAULT_PATTERN,
    kind: patternKind(node),
    aspect: clamp(numberParam(node, 'aspect', DEFAULT_PATTERN.aspect ?? 1), 0.2, 8),
    gap: clamp(numberParam(node, 'gap', DEFAULT_PATTERN.gap ?? 0.08), 0, 0.45),
    roundness: clamp(numberParam(node, 'roundness', DEFAULT_PATTERN.roundness ?? 0.12), 0, 0.5),
    jitter: clamp(numberParam(node, 'jitter', DEFAULT_PATTERN.jitter ?? 0.08), 0, 1),
    rotation: clamp(numberParam(node, 'rotation', DEFAULT_PATTERN.rotation ?? 0), -1, 1),
    offset: clamp(numberParam(node, 'offset', DEFAULT_PATTERN.offset ?? 0.5), 0, 1),
    density: clamp(numberParam(node, 'density', DEFAULT_PATTERN.density ?? 1), 0.1, 4),
    edgeWear: clamp(numberParam(node, 'edgeWear', DEFAULT_PATTERN.edgeWear ?? 0.08), 0, 1)
  };
}

function outputChannel(graph: Readonly<SurfaceGraphDefinition>, nodeId: string): SurfaceRuntimeChannel | undefined {
  const channels = graph.outputs.filter((item) => item.source.nodeId === nodeId).map((item) => item.channel);
  if (channels.includes('baseColor') && channels.includes('height')) return 'surface';
  if (channels.includes('baseColor')) return 'color';
  if (channels.includes('height') || channels.includes('normal')) return 'height';
  if (channels.includes('roughness')) return 'roughness';
  if (channels.includes('metallic')) return 'metallic';
  if (channels.includes('ao')) return 'ao';
  if (channels.includes('emissive')) return 'emissive';
  if (channels.includes('clearcoat')) return 'clearcoat';
  if (channels.includes('sss')) return 'sss';
  return undefined;
}

function runtimeForNode(
  graph: Readonly<SurfaceGraphDefinition>,
  node: Readonly<SurfaceGraphNode>
): SurfaceGraphRuntimeLayer | undefined {
  if (node.kind === 'output') return undefined;
  const channel = outputChannel(graph, node.id);
  const common = {
    channel,
    opacity: clamp(numberParam(node, 'opacity', 1), 0, 1),
    scale: clamp(numberParam(node, 'scale', 4), 0.1, 20),
    strength: clamp(numberParam(node, 'strength', 1), 0, 2.5),
    seed: clamp(numberParam(node, 'seed', 17), 0, 100),
    colorA: stringParam(node, 'colorA', DEFAULT_COLORS[0]),
    colorB: stringParam(node, 'colorB', DEFAULT_COLORS[1])
  } as const;

  if (node.kind === 'shape') {
    return { ...common, kind: 'sdf', displacement: channel === 'height' || channel === 'surface' ? 0.025 : 0 };
  }
  if (node.kind === 'noise') return { ...common, kind: 'fbm', displacement: channel === 'height' ? 0.02 : 0 };
  if (node.kind === 'tile-sampler' || node.kind === 'shape-splatter') {
    return {
      ...common,
      kind: 'pattern',
      displacement: channel === 'height' || channel === 'surface' ? 0.035 : 0,
      pattern: patternForNode(node)
    };
  }
  if (node.kind === 'flood-fill') return { ...common, kind: 'cellular' };
  if (node.kind === 'flood-random' || node.kind === 'flood-index') return { ...common, kind: 'spots' };
  if (node.kind === 'flood-gradient' || node.kind === 'flood-position') return { ...common, kind: 'gradient' };
  if (node.kind === 'gradient-map' || node.kind === 'rgb-to-hsl' || node.kind === 'hsl-adjust' || node.kind === 'color-variation') {
    return { ...common, kind: 'gradient', channel: channel ?? 'color' };
  }
  if (node.kind === 'height-to-ao') return { ...common, kind: 'ridges', channel: channel ?? 'ao' };
  if (node.kind === 'sdf') return { ...common, kind: 'sdf', displacement: channel === 'height' || channel === 'surface' ? 0.03 : 0 };
  if (node.kind === 'subgraph') return { ...common, kind: 'fbm' };

  const blendMode = BLEND_KIND_TO_MODE[node.kind];
  if (blendMode !== undefined) return { ...common, kind: 'fbm', blendMode };
  if (HEIGHT_KINDS.has(node.kind)) {
    const kind = node.kind === 'edge-detect' || node.kind === 'curvature' || node.kind.startsWith('height-to-')
      ? 'ridges'
      : node.kind.includes('warp') || node.kind === 'swirl'
        ? 'veins'
        : 'fbm';
    return {
      ...common,
      kind,
      displacement: channel === 'height' || channel === 'surface' ? 0.018 : 0,
      roughness: channel === 'roughness' ? 0.12 : 0
    };
  }
  return { ...common, kind: 'fbm' };
}

function reachableNodeIds(graph: Readonly<SurfaceGraphDefinition>): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = incoming.get(edge.to.nodeId) ?? [];
    sources.push(edge.from.nodeId);
    incoming.set(edge.to.nodeId, sources);
  }
  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const source of incoming.get(id) ?? []) visit(source);
  };
  for (const output of graph.outputs) visit(output.source.nodeId);
  return reachable;
}

function incomingRuntimeSources(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  runtimeIds: ReadonlySet<string>
): { structureFrom?: string; maskFrom?: string } {
  const edges = graph.edges.filter((edge) => edge.to.nodeId === nodeId && runtimeIds.has(edge.from.nodeId));
  const maskEdge = edges.find((edge) => ['mask', 'opacity', 'density', 'intensity'].includes(edge.to.port));
  const structureEdge = edges.find((edge) => edge !== maskEdge);
  return {
    structureFrom: structureEdge?.from.nodeId,
    maskFrom: maskEdge?.from.nodeId
  };
}

export function lowerSurfaceGraphRuntimeNodes(
  graph: Readonly<SurfaceGraphDefinition>
): SurfaceGraphNode[] {
  const reachable = reachableNodeIds(graph);
  const candidates = graph.nodes.filter((node) =>
    node.kind !== 'output' && (node.runtime !== undefined || reachable.has(node.id))
  );
  const runtimeIds = new Set(candidates.map((node) => node.id));

  return candidates.map((source) => {
    const node: SurfaceGraphNode = {
      ...source,
      position: { ...source.position },
      params: { ...source.params },
      runtime: source.runtime === undefined
        ? runtimeForNode(graph, source)
        : {
            ...source.runtime,
            pattern: source.runtime.pattern === undefined || source.runtime.pattern === null
              ? source.runtime.pattern
              : { ...source.runtime.pattern }
          }
    };
    if (source.runtime !== undefined || node.runtime === undefined) return node;
    const incoming = incomingRuntimeSources(graph, node.id, runtimeIds);
    if (node.runtime.structureFrom === undefined && incoming.structureFrom !== undefined) {
      node.runtime.structureFrom = incoming.structureFrom;
    }
    if (node.runtime.maskFrom === undefined && incoming.maskFrom !== undefined) {
      node.runtime.maskFrom = incoming.maskFrom;
    }
    return node;
  });
}
