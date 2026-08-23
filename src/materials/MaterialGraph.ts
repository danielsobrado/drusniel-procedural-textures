import type { LayerChannel, MaterialLayer } from './types';

export type MaterialGraphNodeKind = 'generator' | 'structure' | 'output';

export interface MaterialGraphNode {
  id: string;
  label: string;
  kind: MaterialGraphNodeKind;
  layerId: string | null;
}

export interface MaterialGraphEdge {
  from: string;
  to: string;
  role: 'structure' | 'mask' | 'output';
}

export interface MaterialGraph {
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
}

const OUTPUT_CHANNELS: readonly LayerChannel[] = [
  'color', 'roughness', 'height', 'clearcoat', 'sss', 'metallic', 'ao', 'emissive'
];

function routedChannels(channel: LayerChannel): readonly LayerChannel[] {
  return channel === 'surface' ? ['color', 'roughness', 'height'] : [channel];
}

export function compileMaterialGraph(layers: readonly MaterialLayer[]): MaterialGraph {
  const nodes: MaterialGraphNode[] = layers.map((layer) => ({
    id: `layer:${layer.id}`,
    label: layer.name,
    kind: layer.structureSourceLayerId === null ? 'generator' : 'structure',
    layerId: layer.id
  }));
  const edges: MaterialGraphEdge[] = [];
  const usedOutputs = new Set<LayerChannel>();

  for (const layer of layers) {
    if (layer.structureSourceLayerId !== null) {
      edges.push({
        from: `layer:${layer.structureSourceLayerId}`,
        to: `layer:${layer.id}`,
        role: 'structure'
      });
    }
    if (layer.maskSourceLayerId !== null) {
      edges.push({ from: `layer:${layer.maskSourceLayerId}`, to: `layer:${layer.id}`, role: 'mask' });
    }
    for (const channel of routedChannels(layer.channel)) {
      usedOutputs.add(channel);
      edges.push({ from: `layer:${layer.id}`, to: `output:${channel}`, role: 'output' });
    }
  }

  for (const channel of OUTPUT_CHANNELS) {
    if (!usedOutputs.has(channel)) continue;
    nodes.push({ id: `output:${channel}`, label: channel, kind: 'output', layerId: null });
  }
  return { nodes, edges };
}

export function materialGraphHasCycle(graph: Readonly<MaterialGraph>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.role === 'output') continue;
    const next = adjacency.get(edge.from) ?? [];
    next.push(edge.to);
    adjacency.set(edge.from, next);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return graph.nodes.some((node) => node.layerId !== null && visit(node.id));
}
