import { SURFACE_GRAPH_NODE_SPECS, type SurfaceGraphNodeSpec } from '../../core/graph/SurfaceGraphCatalog';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphNode,
  SurfaceGraphNodeKind,
  SurfaceGraphParameterValue,
  SurfaceGraphPosition
} from '../../core/graph/SurfaceGraph';
import { createId } from '../../utils/ids';

const DEFAULT_NODE_PARAMS: Partial<Record<SurfaceGraphNodeKind, Record<string, SurfaceGraphParameterValue>>> = {
  shape: { shape: 'rounded-rect', scale: 4, strength: 1 },
  noise: { scale: 4, strength: 1, seed: 17 },
  'texture-field': {
    textureId: 'perlin.01',
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    contrast: 1,
    bias: 0,
    mode: 'replace',
    modeAmount: 1
  },
  'tile-sampler': { pattern: 'tile', aspect: 1, gap: 0.08, roundness: 0.12, jitter: 0.08, rotation: 0, offset: 0.5, density: 1, edgeWear: 0.08 },
  'shape-splatter': { shape: 'disc', scale: 4, jitter: 0.2, rotation: 0.1, density: 1 },
  'flood-random': { seed: 17, strength: 1 },
  'flood-gradient': { rotation: 0, strength: 1 },
  bevel: { strength: 0.3 },
  'slope-blur': { strength: 0.35 },
  blur: { strength: 0.25 },
  'non-uniform-blur': { strength: 0.25 },
  emboss: { strength: 0.25 },
  sharpen: { strength: 0.25 },
  warp: { strength: 0.35 },
  'directional-warp': { strength: 0.35, rotation: 0 },
  'vector-warp': { strength: 0.35 },
  'multi-direction-warp': { strength: 0.35 },
  swirl: { strength: 0.25 },
  'slope-warp': { strength: 0.35 },
  levels: { contrast: 1, bias: 0 },
  'histogram-scan': { position: 0.5, contrast: 0.5 },
  'histogram-range': { position: 0.5, range: 0.5 },
  clamp: { min: 0, max: 1 },
  contrast: { contrast: 1 },
  'gradient-map': { colorA: '#283038', colorB: '#aab4bd' },
  posterize: { steps: 6 },
  quantize: { steps: 6 },
  'transform-2d': { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 },
  tile: { scale: 2 },
  'polar-transform': { strength: 1 },
  blend: { opacity: 1 },
  overlay: { opacity: 1 },
  'normal-blend': { opacity: 1 },
  'normal-rotate': { rotation: 0 },
  'hsl-adjust': { hue: 0, saturation: 0, lightness: 0 },
  'color-variation': { strength: 0.25, seed: 17 },
  sdf: { shape: 'rounded-rect', scale: 4, strength: 1 }
};

export const GRAPH_NODE_WIDTH = 232;
export const GRAPH_VIRTUAL_OUTPUT_ID = '__ptl-material-output';

export function surfaceGraphNodeSpec(kind: SurfaceGraphNodeKind): SurfaceGraphNodeSpec {
  const spec = SURFACE_GRAPH_NODE_SPECS.find((item) => item.kind === kind);
  if (spec === undefined) throw new Error(`Unknown surface graph node kind: ${kind}.`);
  return spec;
}

export function graphNodeBrowserSpecs(_graph: Readonly<SurfaceGraphDefinition>): readonly SurfaceGraphNodeSpec[] {
  return SURFACE_GRAPH_NODE_SPECS.filter((spec) => spec.kind !== 'output' && spec.kind !== 'subgraph');
}

export function createSurfaceGraphNode(
  _graph: Readonly<SurfaceGraphDefinition>,
  kind: SurfaceGraphNodeKind,
  position: SurfaceGraphPosition
): SurfaceGraphNode {
  if (kind === 'output') throw new Error('Material output is managed by the graph workspace.');
  if (kind === 'subgraph') {
    throw new Error('Nested subgraph authoring is not executable in Surface Designer V0.3.');
  }
  const spec = surfaceGraphNodeSpec(kind);
  return {
    id: createId('graph-node'),
    kind,
    label: spec.label,
    position: { ...position },
    params: { ...(DEFAULT_NODE_PARAMS[kind] ?? {}) }
  };
}

export function duplicateSurfaceGraphNode(
  source: Readonly<SurfaceGraphNode>,
  position: SurfaceGraphPosition
): SurfaceGraphNode {
  return {
    ...structuredClone(source),
    id: createId('graph-node'),
    label: `${source.label} copy`,
    position: { ...position }
  };
}

export function humanizeGraphParameter(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function graphExposedId(nodeId: string, parameter: string): string {
  return `${nodeId}-${parameter}`.replace(/[^a-z0-9._:-]+/giu, '-').slice(0, 128);
}

export function graphOutputPosition(graph: Readonly<SurfaceGraphDefinition>): SurfaceGraphPosition {
  const nodes = graph.nodes.filter((node) => node.kind !== 'output');
  if (nodes.length === 0) return { x: 420, y: 120 };
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return { x: maxX + 360, y: minY + 40 };
}
