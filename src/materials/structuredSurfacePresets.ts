import type {
  SurfaceGraphDefinition,
  SurfaceGraphExposedParameter,
  SurfaceGraphNode,
  SurfaceGraphRuntimeLayer
} from '../core/graph/SurfaceGraph';
import { compileSurfaceGraph } from './SurfaceGraphCompiler';
import type { MaterialPreset, PhysicalSettings, SynthesisSettings } from './types';

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

function graph(
  id: string,
  name: string,
  nodes: SurfaceGraphNode[],
  outputs: SurfaceGraphDefinition['outputs'],
  exposed: SurfaceGraphExposedParameter[] = []
): SurfaceGraphDefinition {
  return {
    version: 1,
    id,
    name,
    nodes: [...nodes, node('output', 'output', 'PBR Output', 760, 80)],
    edges: [],
    outputs,
    exposed,
    groups: [],
    subgraphs: []
  };
}

function preset(
  definition: SurfaceGraphDefinition,
  description: string,
  tags: string[],
  physical: Partial<PhysicalSettings>,
  synthesis: Partial<SynthesisSettings> = {}
): MaterialPreset {
  let compiled: ReturnType<typeof compileSurfaceGraph> | null = null;
  const compilation = (): ReturnType<typeof compileSurfaceGraph> => {
    compiled ??= compileSurfaceGraph(definition);
    return compiled;
  };

  return {
    id: definition.id,
    name: definition.name,
    description,
    tags: ['surface-designer', 'v0.3', ...tags],
    physical,
    synthesis,
    get groups() { return compilation().groups; },
    get layers() { return compilation().layers; },
    get graph() { return compilation().graph; }
  };
}

const BRICK_PATTERN = {
  kind: 'brick' as const,
  aspect: 2.45,
  gap: 0.125,
  roundness: 0.1,
  jitter: 0.08,
  rotation: 0,
  offset: 0.5,
  density: 1,
  edgeWear: 0.34
};

const BRICK_GRAPH = graph('designer-old-brick-wall', 'Designer · Old Brick Wall', [
  node('mortar', 'noise', 'Mortar Base', 0, 0, {
    kind: 'base', channel: 'surface', blendMode: 'normal', colorA: '#5b5146', colorB: '#817466', roughness: 0.16
  }),
  node('brick-tiles', 'tile-sampler', 'Running Bond Bricks', 180, 0, {
    kind: 'pattern', channel: 'surface', blendMode: 'normal', scale: 4.15, strength: 1.25, seed: 14,
    colorA: '#6f2d21', colorB: '#b85a3b', roughness: 0.055, displacement: 0.026,
    pattern: BRICK_PATTERN
  }, { xAmount: 7, gap: 0.125, edgeWear: 0.34, bond: 'running' }),
  node('variation', 'color-variation', 'Per-Brick Variation', 380, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.26, scale: 4.15, strength: 1, seed: 37,
    colorA: '#4a211b', colorB: '#d17a52', structureFrom: 'brick-tiles', pattern: BRICK_PATTERN
  }),
  node('face-grain', 'noise', 'Clay Face Grain', 380, 95, {
    kind: 'fbm', channel: 'roughness', blendMode: 'overlay', opacity: 0.2, scale: 18, strength: 1, seed: 63,
    colorA: '#3f2d26', colorB: '#9b6a55', roughness: 0.12, maskFrom: 'brick-tiles', maskStrength: 0.9
  }),
  node('mortar-dirt', 'noise', 'Mortar Dirt', 580, 95, {
    kind: 'fbm', channel: 'color', blendMode: 'multiply', opacity: 0.2, scale: 7.2, strength: 1, seed: 75,
    colorA: '#312b25', colorB: '#71665b', maskFrom: 'brick-tiles', maskInvert: true, maskStrength: 0.86
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'brick-tiles', port: 'height' } },
  { channel: 'roughness', source: { nodeId: 'face-grain', port: 'height' } }
], [
  { id: 'brick-scale', label: 'Brick Scale', nodeId: 'brick-tiles', parameter: 'xAmount', type: 'float', defaultValue: 7, min: 2, max: 16, step: 1 },
  { id: 'mortar-gap', label: 'Mortar Width', nodeId: 'brick-tiles', parameter: 'gap', type: 'float', defaultValue: 0.125, min: 0.03, max: 0.24, step: 0.005 },
  { id: 'damage', label: 'Edge Wear', nodeId: 'brick-tiles', parameter: 'edgeWear', type: 'float', defaultValue: 0.34, min: 0, max: 0.8, step: 0.01 }
]);

const ROOF_PATTERN = {
  kind: 'roof-tile' as const,
  aspect: 0.78,
  gap: 0.055,
  roundness: 0.22,
  jitter: 0.06,
  rotation: 0,
  offset: 0.5,
  density: 1,
  edgeWear: 0.14
};

const ROOF_GRAPH = graph('designer-clay-roof-tiles', 'Designer · Clay Roof Tiles', [
  node('underlay', 'noise', 'Roof Underlay', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#30221d', colorB: '#554036', roughness: 0.16
  }),
  node('tiles', 'tile-sampler', 'Overlapping Barrel Tiles', 190, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.96, scale: 4.8, strength: 1.22, seed: 18,
    colorA: '#6e3022', colorB: '#bd6842', roughness: 0.055, displacement: 0.028, pattern: ROOF_PATTERN
  }),
  node('variation', 'color-variation', 'Fired Clay Variation', 390, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.25, scale: 4.8, seed: 42,
    colorA: '#4c241c', colorB: '#d98a57', structureFrom: 'tiles', pattern: ROOF_PATTERN
  }),
  node('weather', 'noise', 'Weathering', 580, 90, {
    kind: 'fbm', channel: 'roughness', opacity: 0.22, scale: 9, seed: 72,
    colorA: '#342d25', colorB: '#8c7c67', roughness: 0.18, maskFrom: 'tiles', maskStrength: 0.85
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'tiles', port: 'height' } },
  { channel: 'roughness', source: { nodeId: 'weather', port: 'height' } }
]);

const PLANK_PATTERN = {
  kind: 'plank' as const,
  aspect: 5.6,
  gap: 0.055,
  roundness: 0.045,
  jitter: 0.07,
  rotation: 0,
  offset: 0.5,
  density: 1,
  edgeWear: 0.24
};

const WOOD_GRAPH = graph('designer-weathered-planks', 'Designer · Weathered Wood Planks', [
  node('wood-base', 'noise', 'Dark Seams', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#2f2119', colorB: '#57402f', roughness: 0.15
  }),
  node('planks', 'tile-sampler', 'Staggered Planks', 180, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.94, scale: 3.65, strength: 1.18, seed: 9,
    colorA: '#49301f', colorB: '#846141', roughness: 0.04, displacement: 0.018, pattern: PLANK_PATTERN
  }),
  node('variation', 'color-variation', 'Board Variation', 380, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.3, scale: 3.65, seed: 29,
    colorA: '#2d1c14', colorB: '#a17951', structureFrom: 'planks', pattern: PLANK_PATTERN
  }),
  node('grain', 'directional-warp', 'Long Grain', 380, 95, {
    kind: 'veins', channel: 'color', blendMode: 'overlay', opacity: 0.24, scale: 10.5, strength: 1.15, seed: 31,
    colorA: '#24170f', colorB: '#9b754e', maskFrom: 'planks', maskStrength: 0.88
  }),
  node('cracks', 'noise', 'Dry Surface', 580, 95, {
    kind: 'ridges', channel: 'roughness', opacity: 0.18, scale: 17, strength: 1.4, seed: 65,
    colorA: '#17110d', colorB: '#756452', roughness: 0.14, maskFrom: 'planks', maskStrength: 0.8
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'planks', port: 'height' } },
  { channel: 'roughness', source: { nodeId: 'cracks', port: 'height' } }
]);

const TILE_PATTERN = {
  kind: 'tile' as const,
  aspect: 1,
  gap: 0.085,
  roundness: 0.075,
  jitter: 0.015,
  rotation: 0,
  offset: 0,
  density: 1,
  edgeWear: 0.025
};

const CERAMIC_GRAPH = graph('designer-ceramic-tiles', 'Designer · Ceramic Tiles', [
  node('grout', 'noise', 'Recessed Grout', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#777771', colorB: '#a29f96', roughness: 0.17
  }),
  node('tiles', 'tile-sampler', 'Ceramic Tile Grid', 190, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.97, scale: 4.55, strength: 1.12, seed: 13,
    colorA: '#31576a', colorB: '#7ba3af', roughness: -0.055, displacement: 0.012, pattern: TILE_PATTERN
  }),
  node('variation', 'color-variation', 'Glaze Variation', 390, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.11, scale: 4.55, seed: 33,
    colorA: '#315466', colorB: '#99bcc4', structureFrom: 'tiles', pattern: TILE_PATTERN
  }),
  node('glaze', 'color-variation', 'Glossy Glaze', 580, 80, {
    kind: 'pattern', channel: 'clearcoat', opacity: 0.58, scale: 4.55, strength: 1, seed: 13,
    colorA: '#597984', colorB: '#e8f4f5', roughness: 0.08, structureFrom: 'tiles', pattern: TILE_PATTERN
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'tiles', port: 'height' } },
  { channel: 'clearcoat', source: { nodeId: 'glaze', port: 'color' } }
]);

const FABRIC_PATTERN = {
  kind: 'fabric' as const,
  aspect: 1,
  gap: 0.12,
  roundness: 0.3,
  jitter: 0.08,
  rotation: 0,
  offset: 0,
  density: 1.55,
  edgeWear: 0.08
};

const FABRIC_GRAPH = graph('designer-woven-fabric', 'Designer · Woven Fabric', [
  node('base', 'noise', 'Fabric Ground', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#292d30', colorB: '#454b50', roughness: 0.22
  }),
  node('weave', 'tile-sampler', 'Irregular Warp & Weft', 190, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.72, scale: 15, strength: 1.08, seed: 22,
    colorA: '#363a3e', colorB: '#858d94', roughness: 0.11, displacement: 0.004, pattern: FABRIC_PATTERN
  }),
  node('variation', 'color-variation', 'Thread Variation', 390, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.16, scale: 15, seed: 43,
    colorA: '#25282b', colorB: '#9aa1a7', structureFrom: 'weave', pattern: FABRIC_PATTERN
  }),
  node('fiber', 'noise', 'Fiber Roughness', 580, 80, {
    kind: 'fbm', channel: 'roughness', opacity: 0.24, scale: 20, seed: 59,
    colorA: '#1c2023', colorB: '#8e969b', roughness: 0.16
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'weave', port: 'height' } },
  { channel: 'roughness', source: { nodeId: 'fiber', port: 'height' } }
]);

const PEBBLE_PATTERN = {
  kind: 'pebble' as const,
  aspect: 1.25,
  gap: 0.12,
  roundness: 0.4,
  jitter: 0.92,
  rotation: 0.72,
  offset: 0,
  density: 1.25,
  edgeWear: 0.2
};

const GRAVEL_GRAPH = graph('designer-river-gravel', 'Designer · River Gravel', [
  node('bed', 'noise', 'Fine River Bed', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#34312d', colorB: '#696158', roughness: 0.2, displacement: 0.004
  }),
  node('stones', 'shape-splatter', 'Irregular Pebbles', 190, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.9, scale: 6.3, strength: 1.22, seed: 33,
    colorA: '#46423d', colorB: '#a89d8b', roughness: 0.045, displacement: 0.025, pattern: PEBBLE_PATTERN
  }),
  node('variation', 'color-variation', 'Stone Variation', 390, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.32, scale: 6.3, seed: 68,
    colorA: '#303436', colorB: '#c2ad8e', structureFrom: 'stones', pattern: PEBBLE_PATTERN
  }),
  node('wet', 'color-variation', 'Wet Stone Film', 580, 80, {
    kind: 'pattern', channel: 'clearcoat', opacity: 0.18, scale: 6.3, seed: 84,
    colorA: '#263137', colorB: '#d9e8ef', roughness: 0.12, structureFrom: 'stones', pattern: PEBBLE_PATTERN
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'stones', port: 'height' } },
  { channel: 'clearcoat', source: { nodeId: 'wet', port: 'color' } }
]);

const ASPHALT_PATTERN = {
  ...PEBBLE_PATTERN,
  aspect: 1.05,
  gap: 0.05,
  jitter: 1,
  density: 2.8,
  edgeWear: 0.35
};

const ASPHALT_GRAPH = graph('designer-road-asphalt', 'Designer · Road Asphalt', [
  node('binder', 'noise', 'Bitumen Binder', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#151719', colorB: '#292c2d', roughness: 0.16
  }),
  node('aggregate', 'shape-splatter', 'Dense Aggregate', 190, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.58, scale: 11.5, strength: 1.12, seed: 36,
    colorA: '#282a29', colorB: '#5e5d59', roughness: 0.1, displacement: 0.007, pattern: ASPHALT_PATTERN
  }),
  node('fine', 'noise', 'Fine Mineral Grain', 390, 0, {
    kind: 'fbm', channel: 'roughness', opacity: 0.3, scale: 20, seed: 67,
    colorA: '#111315', colorB: '#45484a', roughness: 0.15
  }),
  node('dust', 'noise', 'Road Dust', 580, 80, {
    kind: 'fbm', channel: 'color', blendMode: 'overlay', opacity: 0.08, scale: 5.5, seed: 91,
    colorA: '#252626', colorB: '#77736a'
  })
], [
  { channel: 'baseColor', source: { nodeId: 'dust', port: 'height' } },
  { channel: 'height', source: { nodeId: 'aggregate', port: 'height' } },
  { channel: 'roughness', source: { nodeId: 'fine', port: 'height' } }
]);

const COBBLE_PATTERN = {
  ...PEBBLE_PATTERN,
  aspect: 1.4,
  gap: 0.105,
  density: 1.08,
  edgeWear: 0.28
};

const COBBLE_GRAPH = graph('designer-cobblestone', 'Designer · Cobblestone', [
  node('mortar', 'noise', 'Packed Joint Bed', 0, 0, {
    kind: 'base', channel: 'surface', colorA: '#474641', colorB: '#716d65', roughness: 0.19
  }),
  node('stones', 'shape-splatter', 'Irregular Cobblestones', 190, 0, {
    kind: 'pattern', channel: 'surface', opacity: 0.92, scale: 5.1, strength: 1.2, seed: 41,
    colorA: '#3e4341', colorB: '#9a9588', roughness: 0.055, displacement: 0.03, pattern: COBBLE_PATTERN
  }),
  node('variation', 'color-variation', 'Stone Variation', 390, 0, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.3, scale: 5.1, seed: 81,
    colorA: '#343938', colorB: '#b3a990', structureFrom: 'stones', pattern: COBBLE_PATTERN
  }),
  node('surface', 'noise', 'Stone Surface', 390, 95, {
    kind: 'fbm', channel: 'roughness', opacity: 0.2, scale: 14, seed: 73,
    colorA: '#2a2d2c', colorB: '#858077', roughness: 0.14, maskFrom: 'stones', maskStrength: 0.9
  }),
  node('moss', 'noise', 'Moss in Joints', 580, 95, {
    kind: 'fbm', channel: 'color', blendMode: 'overlay', opacity: 0.12, scale: 8.5, seed: 92,
    colorA: '#20301d', colorB: '#5b6d43', maskFrom: 'stones', maskInvert: true, maskStrength: 0.82
  })
], [
  { channel: 'baseColor', source: { nodeId: 'variation', port: 'color' } },
  { channel: 'height', source: { nodeId: 'stones', port: 'height' } },
  { channel: 'roughness', source: { nodeId: 'surface', port: 'height' } }
]);

export const STRUCTURED_SURFACE_PRESETS: readonly MaterialPreset[] = [
  preset(BRICK_GRAPH, 'Running-bond masonry with visible recessed mortar, chipped clay edges and restrained per-brick variation.', ['brick', 'masonry', 'construction'], { roughness: 0.72, clearcoat: 0.012, clearcoatRoughness: 0.78, specularIntensity: 0.28 }, { age: 0.32, weathering: 0.34, variation: 0.34 }),
  preset(ROOF_GRAPH, 'Overlapping barrel clay tiles with readable courses, fired-clay variation and shallow weathered relief.', ['roof', 'tile', 'construction'], { roughness: 0.64, clearcoat: 0.025, clearcoatRoughness: 0.68, specularIntensity: 0.3 }, { age: 0.22, weathering: 0.3, variation: 0.3 }),
  preset(WOOD_GRAPH, 'Staggered weathered boards with visible seams, restrained cupping, long grain and dry surface breakup.', ['wood', 'plank', 'construction'], { roughness: 0.66, sheen: 0.025, specularIntensity: 0.28 }, { age: 0.34, weathering: 0.36, variation: 0.38 }),
  preset(CERAMIC_GRAPH, 'Clean ceramic tiles with stable grout lines, shallow bevels and localized glossy glaze.', ['ceramic', 'tile', 'interior'], { roughness: 0.28, clearcoat: 0.64, clearcoatRoughness: 0.16, specularIntensity: 0.64 }, { variation: 0.08 }),
  preset(FABRIC_GRAPH, 'Irregular woven fabric with softened warp-and-weft crossings and fine fiber roughness breakup.', ['fabric', 'woven', 'interior'], { roughness: 0.72, sheen: 0.42, sheenRoughness: 0.68, sheenColor: '#b8c0c5' }, { variation: 0.2 }),
  preset(GRAVEL_GRAPH, 'Irregular layered river pebbles over a fine bed with restrained relief and localized wet stone response.', ['gravel', 'stone', 'ground'], { roughness: 0.6, clearcoat: 0.1, clearcoatRoughness: 0.26, specularIntensity: 0.34 }, { variation: 0.46, stochasticTiling: 0.2 }),
  preset(ASPHALT_GRAPH, 'Dense asphalt aggregate embedded in dark binder with fine mineral roughness and subtle road dust.', ['asphalt', 'road', 'ground'], { roughness: 0.78, specularIntensity: 0.22 }, { variation: 0.38, stochasticTiling: 0.18 }),
  preset(COBBLE_GRAPH, 'Irregular cobblestones with visible joint bed, individual stone variation and protected-joint moss.', ['cobblestone', 'stone', 'construction'], { roughness: 0.7, clearcoat: 0.025, clearcoatRoughness: 0.65, specularIntensity: 0.28 }, { age: 0.38, weathering: 0.44, variation: 0.46 })
];
