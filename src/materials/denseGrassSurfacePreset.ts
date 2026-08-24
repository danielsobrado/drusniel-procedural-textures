import type {
  SurfaceGraphDefinition,
  SurfaceGraphNode,
  SurfaceGraphRuntimeLayer
} from '../core/graph/SurfaceGraph';
import { compileSurfaceGraph } from './SurfaceGraphCompiler';
import type { MaterialPreset } from './types';

function node(
  id: string,
  kind: SurfaceGraphNode['kind'],
  label: string,
  x: number,
  y: number,
  runtime?: SurfaceGraphRuntimeLayer,
  params: SurfaceGraphNode['params'] = {}
): SurfaceGraphNode {
  return { id, kind, label, position: { x, y }, params, runtime };
}

const MAIN_TURF_PATTERN = {
  kind: 'turf' as const,
  aspect: 1,
  gap: 0.02,
  roundness: 0.08,
  jitter: 0.72,
  rotation: 0.03,
  offset: 0.5,
  density: 2.45,
  edgeWear: 0.16,
  clumpScale: 0.62,
  clumpStrength: 0.72,
  directionality: 0.66,
  dryness: 0.04,
  rootDarkening: 0.72,
  fiberLength: 0.38,
  fiberWidth: 0.052,
  fiberBreakup: 0.58,
  fiberSoftness: 0.74
};

const ACCENT_BLADE_PATTERN = {
  kind: 'grass' as const,
  aspect: 0.22,
  gap: 0.02,
  roundness: 0.08,
  jitter: 0.66,
  rotation: 0.04,
  offset: 0.5,
  density: 1.35,
  edgeWear: 0.1,
  bladeLength: 0.82,
  bladeWidth: 0.025,
  bladeTaper: 2,
  bladeBend: 0.1,
  bladeCurvature: 1.6,
  clumpScale: 0.58,
  clumpStrength: 0.44,
  directionality: 0.58,
  dryness: 0.12,
  tipFade: 0.1,
  rootDarkening: 0.54,
  heightJitter: 0.38,
  widthJitter: 0.32,
  leanJitter: 0.62
};

const DENSE_GRASS_GRAPH: SurfaceGraphDefinition = {
  version: 1,
  id: 'designer-dense-grass',
  name: 'Designer · Dense Grass',
  nodes: [
    node('soil', 'noise', 'Soil & Thatch', 0, 0, {
      kind: 'fbm',
      channel: 'surface',
      blendMode: 'normal',
      scale: 4.6,
      strength: 1.06,
      seed: 7,
      colorA: '#12170f',
      colorB: '#313722',
      roughness: 0.22,
      displacement: 0.003
    }, { scale: 4.6 }),
    node('main-turf', 'shape-splatter', 'Turf Fiber Mass', 200, 80, {
      kind: 'pattern',
      channel: 'surface',
      blendMode: 'overlay',
      opacity: 0.86,
      scale: 11.6,
      strength: 1.18,
      seed: 28,
      colorA: '#183019',
      colorB: '#6e9148',
      roughness: 0.015,
      displacement: 0.004,
      pattern: MAIN_TURF_PATTERN
    }, { density: 2.45, clump: 0.72 }),
    node('turf-variation', 'color-variation', 'Turf Color Variation', 410, 60, {
      kind: 'pattern',
      channel: 'color',
      blendMode: 'overlay',
      opacity: 0.28,
      scale: 11.6,
      strength: 1.04,
      seed: 44,
      colorA: '#1e381d',
      colorB: '#8aa755',
      structureFrom: 'main-turf',
      pattern: MAIN_TURF_PATTERN
    }, { amount: 0.28 }),
    node('young-blades', 'shape-splatter', 'Sparse Blade Accents', 410, 155, {
      kind: 'pattern',
      channel: 'color',
      blendMode: 'screen',
      opacity: 0.055,
      scale: 12.4,
      strength: 1.08,
      seed: 59,
      colorA: '#4b7139',
      colorB: '#9cbd65',
      pattern: ACCENT_BLADE_PATTERN
    }, { density: 1.35, clump: 0.44 }),
    node('dry-thatch', 'shape-splatter', 'Dry Thatch', 610, 155, {
      kind: 'pattern',
      channel: 'color',
      blendMode: 'overlay',
      opacity: 0.13,
      scale: 13.2,
      strength: 1.02,
      seed: 76,
      colorA: '#625a38',
      colorB: '#a2915f',
      pattern: {
        ...MAIN_TURF_PATTERN,
        density: 2.1,
        clumpStrength: 0.5,
        directionality: 0.48,
        dryness: 0.62,
        rootDarkening: 0.38,
        fiberLength: 0.34,
        fiberWidth: 0.038,
        fiberBreakup: 0.82,
        fiberSoftness: 0.62
      }
    }, { density: 2.1, clump: 0.5 }),
    node('root-shadow', 'height-to-ao', 'Root Shadow', 610, 55, {
      kind: 'pattern',
      channel: 'ao',
      blendMode: 'multiply',
      opacity: 0.14,
      scale: 11.6,
      strength: 0.88,
      seed: 28,
      structureFrom: 'main-turf',
      pattern: MAIN_TURF_PATTERN
    }),
    node('output', 'output', 'PBR Output', 820, 100)
  ],
  edges: [],
  outputs: [
    { channel: 'baseColor', source: { nodeId: 'turf-variation', port: 'color' } },
    { channel: 'height', source: { nodeId: 'main-turf', port: 'height' } },
    { channel: 'ao', source: { nodeId: 'root-shadow', port: 'mask' } }
  ],
  exposed: [],
  groups: [],
  subgraphs: []
};

let compiled: ReturnType<typeof compileSurfaceGraph> | null = null;

function compilation(): ReturnType<typeof compileSurfaceGraph> {
  compiled ??= compileSurfaceGraph(DENSE_GRASS_GRAPH);
  return compiled;
}

export const DENSE_GRASS_SURFACE_PRESET: MaterialPreset = {
  id: DENSE_GRASS_GRAPH.id,
  name: DENSE_GRASS_GRAPH.name,
  description: 'Dense matted turf built from short broken fibers and thatch, with only sparse individual blade accents.',
  tags: ['surface-designer', 'v0.3', 'grass', 'ground', 'organic'],
  physical: {
    roughness: 0.7,
    metalness: 0,
    clearcoat: 0.008,
    clearcoatRoughness: 0.68,
    specularIntensity: 0.24,
    ior: 1.38,
    sheen: 0.12,
    sheenRoughness: 0.84,
    sheenColor: '#60784a',
    transmission: 0,
    thickness: 0,
    attenuationDistance: 2,
    attenuationColor: '#ffffff'
  },
  synthesis: {
    age: 0.08,
    weathering: 0.06,
    gravity: -1,
    macro: 0.86,
    meso: 1,
    micro: 1.18,
    variation: 0.44,
    stochasticTiling: 0.16
  },
  get groups() { return compilation().groups; },
  get layers() { return compilation().layers; },
  get graph() { return compilation().graph; }
};
