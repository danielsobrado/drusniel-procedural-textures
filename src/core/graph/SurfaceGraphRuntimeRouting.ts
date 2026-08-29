import { SURFACE_GRAPH_NODE_SPEC_BY_KIND } from './SurfaceGraphCatalog';
import type { SurfaceGraphDefinition, SurfaceGraphEdge } from './SurfaceGraph';

const MASK_INPUT_PORTS = new Set(['mask', 'opacity', 'density', 'intensity']);
const MAX_RUNTIME_INPUTS = 2;

export interface SurfaceGraphRuntimeInputRoutes {
  structureFrom?: string;
  maskFrom?: string;
  overridesStructure: boolean;
  overridesMask: boolean;
}

function orderedIncomingEdges(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  eligibleSourceIds?: ReadonlySet<string>
): SurfaceGraphEdge[] {
  const node = graph.nodes.find((item) => item.id === nodeId);
  const spec = node === undefined ? undefined : SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(node.kind);
  const inputOrder = new Map((spec?.inputs ?? []).map((port, index) => [port.name, index] as const));
  return graph.edges
    .filter((edge) => edge.to.nodeId === nodeId && (eligibleSourceIds === undefined || eligibleSourceIds.has(edge.from.nodeId)))
    .slice()
    .sort((left, right) => (inputOrder.get(left.to.port) ?? Number.MAX_SAFE_INTEGER) -
      (inputOrder.get(right.to.port) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Incoming edges keyed by the input port they land on, for nodes whose lowering binds inputs
 * by name rather than by the two-slot structure/mask heuristic. Later edges win, which is
 * unreachable in a validated graph — `validateUnambiguousGraph` rejects a doubly driven input.
 */
export function surfaceGraphNamedInputSources(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  eligibleSourceIds?: ReadonlySet<string>
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.to.nodeId !== nodeId) continue;
    if (eligibleSourceIds !== undefined && !eligibleSourceIds.has(edge.from.nodeId)) continue;
    sources.set(edge.to.port, edge.from.nodeId);
  }
  return sources;
}

export function surfaceGraphRuntimeInputRoutes(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  eligibleSourceIds?: ReadonlySet<string>
): SurfaceGraphRuntimeInputRoutes {
  const edges = orderedIncomingEdges(graph, nodeId, eligibleSourceIds);
  if (edges.length > MAX_RUNTIME_INPUTS) {
    const node = graph.nodes.find((item) => item.id === nodeId);
    throw new Error(
      `Surface graph node ${node?.label ?? nodeId} has ${edges.length} connected runtime inputs; ` +
      `the V0.3 runtime layer lowering supports at most ${MAX_RUNTIME_INPUTS}.`
    );
  }
  if (edges.length === 0) {
    return { overridesStructure: false, overridesMask: false };
  }
  if (edges.length === 1) {
    const edge = edges[0]!;
    if (MASK_INPUT_PORTS.has(edge.to.port)) {
      return { maskFrom: edge.from.nodeId, overridesStructure: false, overridesMask: true };
    }
    return { structureFrom: edge.from.nodeId, overridesStructure: true, overridesMask: false };
  }

  const first = edges[0]!;
  const second = edges[1]!;
  const firstMask = MASK_INPUT_PORTS.has(first.to.port);
  const secondMask = MASK_INPUT_PORTS.has(second.to.port);
  if (firstMask && !secondMask) {
    return {
      structureFrom: second.from.nodeId,
      maskFrom: first.from.nodeId,
      overridesStructure: true,
      overridesMask: true
    };
  }
  if (!firstMask && secondMask) {
    return {
      structureFrom: first.from.nodeId,
      maskFrom: second.from.nodeId,
      overridesStructure: true,
      overridesMask: true
    };
  }
  if (firstMask && secondMask) {
    return {
      structureFrom: second.from.nodeId,
      maskFrom: first.from.nodeId,
      overridesStructure: true,
      overridesMask: true
    };
  }
  return {
    structureFrom: first.from.nodeId,
    maskFrom: second.from.nodeId,
    overridesStructure: true,
    overridesMask: true
  };
}
