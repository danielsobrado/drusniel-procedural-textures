import { SURFACE_GRAPH_NODE_SPEC_BY_KIND } from '../../core/graph/SurfaceGraphCatalog';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphEdge,
  SurfaceGraphPortRef,
  SurfaceGraphValueType
} from '../../core/graph/SurfaceGraph';
import { surfaceGraphOutputTypesCompatible } from '../../core/graph/SurfaceGraphMutation';
import { GRAPH_VIRTUAL_OUTPUT_ID } from './GraphNodeFactory';

const OUTPUT_KIND = 'output';
const MASK_INPUT_PORTS = new Set(['mask', 'opacity', 'density', 'intensity']);

export interface GraphConnectionPreview {
  from: SurfaceGraphPortRef;
  type: SurfaceGraphValueType;
  clientX: number;
  clientY: number;
}

function socketSelector(direction: 'input' | 'output'): string {
  return `[data-port-direction="${direction}"][data-node-id][data-port]`;
}

function findSocket(
  host: HTMLElement,
  nodeId: string,
  port: string,
  direction: 'input' | 'output'
): HTMLElement | null {
  return Array.from(host.querySelectorAll<HTMLElement>(socketSelector(direction))).find((socket) =>
    socket.dataset.nodeId === nodeId && socket.dataset.port === port
  ) ?? null;
}

function outputInputType(channel: string): SurfaceGraphValueType | null {
  const outputSpec = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(OUTPUT_KIND);
  return outputSpec?.inputs.find((port) => port.name === channel)?.type ?? null;
}

function sourceSocketForOutput(
  host: HTMLElement,
  graph: Readonly<SurfaceGraphDefinition>,
  source: SurfaceGraphPortRef,
  channel: string
): HTMLElement | null {
  const exact = findSocket(host, source.nodeId, source.port, 'output');
  if (exact !== null) return exact;
  const node = graph.nodes.find((item) => item.id === source.nodeId);
  const targetType = outputInputType(channel);
  const spec = node === undefined ? undefined : SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(node.kind);
  const compatible = targetType === null
    ? undefined
    : spec?.outputs.find((port) => surfaceGraphOutputTypesCompatible(port.type, targetType));
  const fallback = compatible ?? spec?.outputs[0];
  return fallback === undefined ? null : findSocket(host, source.nodeId, fallback.name, 'output');
}

function portType(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string,
  port: string
): SurfaceGraphValueType {
  const node = graph.nodes.find((item) => item.id === nodeId);
  return node === undefined
    ? 'float'
    : SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(node.kind)?.outputs.find((item) => item.name === port)?.type ?? 'float';
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const handle = Math.max(54, Math.min(190, Math.abs(x2 - x1) * 0.46));
  return `M ${x1} ${y1} C ${x1 + handle} ${y1}, ${x2 - handle} ${y2}, ${x2} ${y2}`;
}

function socketCoordinates(socket: HTMLElement, stage: DOMRect): { x: number; y: number } {
  const rect = socket.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - stage.left,
    y: rect.top + rect.height / 2 - stage.top
  };
}

function nodeDependencyPath(
  host: HTMLElement,
  stage: DOMRect,
  sourceId: string,
  targetId: string,
  dependency: 'mask' | 'structure'
): string {
  const source = host.querySelector<HTMLElement>(`[data-graph-node="${CSS.escape(sourceId)}"]`);
  const target = host.querySelector<HTMLElement>(`[data-graph-node="${CSS.escape(targetId)}"]`);
  if (source === null || target === null) return '';
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const x1 = sourceRect.right - stage.left - 2;
  const y1 = sourceRect.top + sourceRect.height * 0.5 - stage.top;
  const x2 = targetRect.left - stage.left + 2;
  const y2 = targetRect.top + targetRect.height * 0.5 - stage.top;
  return `<path class="sg-edge sg-edge-implicit" data-dependency="${dependency}" d="${curvePath(x1, y1, x2, y2)}"></path>`;
}

function formalEdges(graph: Readonly<SurfaceGraphDefinition>): SurfaceGraphEdge[] {
  const outputNode = graph.nodes.find((node) => node.kind === OUTPUT_KIND);
  const targetId = outputNode?.id ?? GRAPH_VIRTUAL_OUTPUT_ID;
  const edges = graph.edges.map((edge) => ({ from: { ...edge.from }, to: { ...edge.to } }));
  for (const output of graph.outputs) {
    const duplicate = edges.some((edge) =>
      edge.from.nodeId === output.source.nodeId && edge.from.port === output.source.port &&
      edge.to.nodeId === targetId && edge.to.port === output.channel
    );
    if (!duplicate) edges.push({ from: { ...output.source }, to: { nodeId: targetId, port: output.channel } });
  }
  return edges;
}

function runtimeOverrides(
  graph: Readonly<SurfaceGraphDefinition>,
  nodeId: string
): { structure: boolean; mask: boolean } {
  const incoming = graph.edges.filter((edge) => edge.to.nodeId === nodeId);
  const maskCount = incoming.filter((edge) => MASK_INPUT_PORTS.has(edge.to.port)).length;
  const structureCount = incoming.length - maskCount;
  return {
    structure: structureCount > 0 || maskCount > 1,
    mask: maskCount > 0 || structureCount > 1
  };
}

function formalEdgePath(
  host: HTMLElement,
  graph: Readonly<SurfaceGraphDefinition>,
  stage: DOMRect,
  edge: Readonly<SurfaceGraphEdge>
): string {
  const target = findSocket(host, edge.to.nodeId, edge.to.port, 'input');
  if (target === null) return '';
  const targetNode = graph.nodes.find((node) => node.id === edge.to.nodeId);
  const source = targetNode?.kind === OUTPUT_KIND || edge.to.nodeId === GRAPH_VIRTUAL_OUTPUT_ID
    ? sourceSocketForOutput(host, graph, edge.from, edge.to.port)
    : findSocket(host, edge.from.nodeId, edge.from.port, 'output');
  if (source === null) return '';
  const start = socketCoordinates(source, stage);
  const end = socketCoordinates(target, stage);
  const type = source.dataset.portType ?? portType(graph, edge.from.nodeId, edge.from.port);
  return `<path class="sg-edge" data-port-type="${type}" d="${curvePath(start.x, start.y, end.x, end.y)}"></path>`;
}

export function drawSurfaceGraphEdges(host: HTMLElement, graph: Readonly<SurfaceGraphDefinition>): void {
  const stageElement = host.querySelector<HTMLElement>('[data-role="graph-stage"]');
  const group = host.querySelector<SVGGElement>('[data-role="graph-edge-paths"]');
  if (stageElement === null || group === null) return;
  const stage = stageElement.getBoundingClientRect();
  const explicit = formalEdges(graph).map((edge) => formalEdgePath(host, graph, stage, edge));
  const dependencies = graph.nodes.flatMap((node) => {
    const paths: string[] = [];
    const structure = node.runtime?.structureFrom;
    const mask = node.runtime?.maskFrom;
    const overrides = runtimeOverrides(graph, node.id);
    if (!overrides.structure && structure !== null && structure !== undefined) {
      paths.push(nodeDependencyPath(host, stage, structure, node.id, 'structure'));
    }
    if (!overrides.mask && mask !== null && mask !== undefined) {
      paths.push(nodeDependencyPath(host, stage, mask, node.id, 'mask'));
    }
    return paths;
  });
  group.innerHTML = [...dependencies, ...explicit].join('');
}

export function drawSurfaceGraphConnectionPreview(
  host: HTMLElement,
  connection: Readonly<GraphConnectionPreview> | null
): void {
  const preview = host.querySelector<SVGGElement>('[data-role="graph-edge-preview"]');
  const stageElement = host.querySelector<HTMLElement>('[data-role="graph-stage"]');
  if (preview === null || stageElement === null || connection === null) {
    if (preview !== null) preview.innerHTML = '';
    return;
  }
  const source = findSocket(host, connection.from.nodeId, connection.from.port, 'output');
  if (source === null) {
    preview.innerHTML = '';
    return;
  }
  const stage = stageElement.getBoundingClientRect();
  const start = socketCoordinates(source, stage);
  const end = { x: connection.clientX - stage.left, y: connection.clientY - stage.top };
  preview.innerHTML = `<path class="sg-edge sg-edge-preview" data-port-type="${connection.type}" d="${curvePath(start.x, start.y, end.x, end.y)}"></path>`;
}
