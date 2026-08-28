import { SURFACE_GRAPH_NODE_SPEC_BY_KIND } from './SurfaceGraphCatalog';
import { surfaceGraphOutputTypesCompatible } from './SurfaceGraphCompatibility';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphNode,
  SurfaceGraphOutput,
  SurfaceGraphValueType
} from './SurfaceGraph';

const OUTPUT_KIND = 'output';

function legacyRuntimePortType(
  node: Readonly<SurfaceGraphNode>,
  port: string
): SurfaceGraphValueType | null {
  const runtime = node.runtime;
  if (runtime === undefined) return null;
  if (port === 'color' && (runtime.channel === 'surface' || runtime.channel === 'color' || runtime.channel === 'emissive')) {
    return 'color';
  }
  if (
    port === 'height' &&
    (runtime.channel === 'surface' || runtime.channel === 'height' || runtime.displacement !== undefined)
  ) {
    return 'height';
  }
  if (
    port === 'value' &&
    (runtime.roughness !== undefined || ['roughness', 'metallic', 'ao', 'clearcoat', 'sss'].includes(runtime.channel ?? ''))
  ) {
    return 'float';
  }
  return null;
}

function runtimeSupportsChannel(
  node: Readonly<SurfaceGraphNode>,
  channel: SurfaceGraphOutput['channel']
): boolean {
  const runtime = node.runtime;
  if (runtime === undefined) return false;
  if (channel === 'baseColor') return runtime.channel === 'surface' || runtime.channel === 'color';
  if (channel === 'height') {
    return runtime.channel === 'surface' || runtime.channel === 'height' || runtime.displacement !== undefined;
  }
  if (channel === 'roughness') return runtime.channel === 'roughness' || runtime.roughness !== undefined;
  if (channel === 'metallic') return runtime.channel === 'metallic';
  if (channel === 'ao') return runtime.channel === 'ao';
  if (channel === 'emissive') return runtime.channel === 'emissive';
  if (channel === 'opacity') return runtime.opacity !== undefined;
  if (channel === 'clearcoat') return runtime.channel === 'clearcoat';
  if (channel === 'sss') return runtime.channel === 'sss';
  return false;
}

function sourcePort(
  nodes: ReadonlyMap<string, SurfaceGraphNode>,
  output: Readonly<SurfaceGraphOutput>
): { node: SurfaceGraphNode; type: SurfaceGraphValueType } {
  const node = nodes.get(output.source.nodeId);
  if (node === undefined) {
    throw new Error(`Graph output ${output.channel} references a missing node.`);
  }
  const port = SURFACE_GRAPH_NODE_SPEC_BY_KIND
    .get(node.kind)
    ?.outputs.find((candidate) => candidate.name === output.source.port);
  if (port !== undefined) return { node, type: port.type };

  const legacyType = legacyRuntimePortType(node, output.source.port);
  if (legacyType !== null) return { node, type: legacyType };

  throw new Error(`Graph output ${output.channel} references missing output port ${node.id}.${output.source.port}.`);
}

export function validateSurfaceGraphOutputContracts(graph: Readonly<SurfaceGraphDefinition>): void {
  const outputNodes = graph.nodes.filter((node) => node.kind === OUTPUT_KIND);
  if (outputNodes.length > 1) {
    throw new Error('Surface graph can contain at most one material output node.');
  }

  const outputSpec = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(OUTPUT_KIND);
  if (outputSpec === undefined) throw new Error('Surface graph output node specification is missing.');

  const nodes = new Map(graph.nodes.map((node) => [node.id, node] as const));
  for (const output of graph.outputs) {
    const source = sourcePort(nodes, output);
    const target = outputSpec.inputs.find((candidate) => candidate.name === output.channel);
    if (target === undefined) {
      throw new Error(`Graph output ${output.channel} does not map to a material output port.`);
    }
    if (!surfaceGraphOutputTypesCompatible(source.type, target.type) && !runtimeSupportsChannel(source.node, output.channel)) {
      throw new Error(
        `Graph output ${output.channel} cannot use ${source.node.id}.${output.source.port} ` +
        `(${source.type}); expected ${target.type}.`
      );
    }
  }

  const outputNode = outputNodes[0];
  if (outputNode !== undefined) {
    for (const edge of graph.edges.filter((candidate) => candidate.to.nodeId === outputNode.id)) {
      const declared = graph.outputs.find((output) => output.channel === edge.to.port);
      if (declared === undefined) {
        throw new Error(`Material output route ${edge.to.port} is missing from graph outputs.`);
      }
      if (declared.source.nodeId !== edge.from.nodeId || declared.source.port !== edge.from.port) {
        throw new Error(`Material output route ${edge.to.port} disagrees with graph outputs.`);
      }
    }
  }

  for (const subgraph of graph.subgraphs) validateSurfaceGraphOutputContracts(subgraph);
}
