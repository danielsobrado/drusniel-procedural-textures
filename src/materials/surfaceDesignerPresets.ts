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
  params: SurfaceGraphNode['params'] = {},
  runtime?: SurfaceGraphRuntimeLayer,
  subgraphId?: string
): SurfaceGraphNode {
  return { id, kind, label, position: { x, y }, params, runtime, subgraphId };
}

const EDGE_DAMAGE_SUBGRAPH: SurfaceGraphDefinition = {
  version: 1,
  id: 'fx-edge-damage',
  name: 'Edge Damage',
  nodes: [
    node('edge', 'edge-detect', 'Edge Detect', 0, 0),
    node('warp', 'slope-warp', 'Broken Edge Warp', 180, 0, { intensity: 0.35 }),
    node('levels', 'levels', 'Damage Levels', 360, 0, { black: 0.35, white: 0.72 })
  ],
  edges: [
    { from: { nodeId: 'edge', port: 'mask' }, to: { nodeId: 'warp', port: 'source' } },
    { from: { nodeId: 'warp', port: 'height' }, to: { nodeId: 'levels', port: 'height' } }
  ],
  outputs: [{ channel: 'height', source: { nodeId: 'levels', port: 'height' } }],
  exposed: [],
  groups: [],
  subgraphs: []
};

const DIRT_SUBGRAPH: SurfaceGraphDefinition = {
  version: 1,
  id: 'fx-dirt-accumulation',
  name: 'Dirt Accumulation',
  nodes: [
    node('cavity', 'height-to-cavity', 'Cavity', 0, 0),
    node('noise', 'noise', 'Dirt Breakup', 0, 100, { scale: 7 }),
    node('multiply', 'multiply', 'Cavity Dirt', 180, 40)
  ],
  edges: [
    { from: { nodeId: 'cavity', port: 'mask' }, to: { nodeId: 'multiply', port: 'a' } },
    { from: { nodeId: 'noise', port: 'height' }, to: { nodeId: 'multiply', port: 'b' } }
  ],
  outputs: [{ channel: 'roughness', source: { nodeId: 'multiply', port: 'height' } }],
  exposed: [],
  groups: [],
  subgraphs: []
};

const MOSS_SUBGRAPH: SurfaceGraphDefinition = {
  version: 1,
  id: 'fx-moss-growth',
  name: 'Moss Growth',
  nodes: [
    node('slope', 'height-to-slope', 'Slope', 0, 0),
    node('noise', 'noise', 'Moss Clumps', 0, 100, { scale: 4 }),
    node('multiply', 'multiply', 'Moss Mask', 180, 50)
  ],
  edges: [
    { from: { nodeId: 'slope', port: 'mask' }, to: { nodeId: 'multiply', port: 'a' } },
    { from: { nodeId: 'noise', port: 'height' }, to: { nodeId: 'multiply', port: 'b' } }
  ],
  outputs: [{ channel: 'baseColor', source: { nodeId: 'multiply', port: 'height' } }],
  exposed: [],
  groups: [],
  subgraphs: []
};

const COMMON_SUBGRAPHS = [EDGE_DAMAGE_SUBGRAPH, DIRT_SUBGRAPH, MOSS_SUBGRAPH];

function graph(
  id: string,
  name: string,
  nodes: SurfaceGraphNode[],
  exposed: SurfaceGraphExposedParameter[] = []
): SurfaceGraphDefinition {
  return {
    version: 1,
    id,
    name,
    nodes,
    edges: [],
    outputs: [
      { channel: 'baseColor', source: { nodeId: nodes.find((item) => item.runtime?.channel === 'color' || item.runtime?.channel === 'surface')?.id ?? nodes[0]!.id, port: 'color' } },
      { channel: 'height', source: { nodeId: nodes.find((item) => item.runtime?.displacement !== undefined)?.id ?? nodes[0]!.id, port: 'height' } },
      { channel: 'roughness', source: { nodeId: nodes.find((item) => item.runtime?.roughness !== undefined)?.id ?? nodes[0]!.id, port: 'value' } }
    ],
    exposed,
    groups: [],
    subgraphs: COMMON_SUBGRAPHS
  };
}

/**
 * Compilation is deferred to first access. Eleven presets were each running
 * normalizeSurfaceGraph + validateUnambiguousGraph + compileMaterialGraph at module
 * evaluation, i.e. on the boot path, even though the library only needs id, name,
 * description and tags to render a card. The compiled result is memoised, so applying a
 * preset costs the same as before.
 */
function makePreset(
  definition: SurfaceGraphDefinition,
  description: string,
  tags: string[],
  physical: Partial<PhysicalSettings>,
  synthesis: Partial<SynthesisSettings> = {}
): MaterialPreset {
  let compiled: ReturnType<typeof compileSurfaceGraph> | null = null;
  const compile = (): ReturnType<typeof compileSurfaceGraph> => {
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
    get groups() { return compile().groups; },
    get layers() { return compile().layers; },
    get graph() { return compile().graph; }
  };
}

const BRICK_GRAPH = graph('designer-old-brick-wall', 'Designer · Old Brick Wall', [
  node('mortar', 'shape', 'Mortar Base', 0, 0, { profile: 'flat' }, {
    kind: 'base', channel: 'surface', blendMode: 'normal', colorA: '#4a4038', colorB: '#6b5a4b', roughness: 0.18
  }),
  node('brick-shape', 'shape', 'Rounded Brick', 0, 100, { shape: 'rounded-rectangle', roundness: 0.12 }),
  node('brick-tiles', 'tile-sampler', 'Running Bond Tile Sampler', 190, 100, { bond: 'running', xAmount: 7, yAmount: 14, gap: 0.095 }, {
    kind: 'pattern', channel: 'surface', blendMode: 'normal', scale: 3.8, strength: 1.55, seed: 14,
    colorA: '#6f261c', colorB: '#b25232', roughness: 0.08, displacement: 0.085,
    pattern: { kind: 'brick', aspect: 2.25, gap: 0.095, roundness: 0.14, jitter: 0.12, offset: 0.5, edgeWear: 0.18 }
  }),
  node('flood', 'flood-fill', 'Flood Fill Bricks', 380, 100),
  node('variation', 'flood-random', 'Per-Brick Variation', 560, 80, { amplitude: 0.24 }, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.34, scale: 3.8, seed: 37,
    colorA: '#341b18', colorB: '#d4774d', structureFrom: 'brick-tiles',
    pattern: { kind: 'brick', aspect: 2.25, gap: 0.095, roundness: 0.14, jitter: 0.12, offset: 0.5, edgeWear: 0.18 }
  }),
  node('bevel', 'bevel', 'Brick Bevel', 380, 190, { distance: 0.08 }),
  node('edge-damage', 'subgraph', 'Edge Damage', 560, 190, { amount: 0.35 }, {
    kind: 'spots', channel: 'height', blendMode: 'overlay', opacity: 0.24, scale: 11, strength: 1.5, seed: 63,
    colorA: '#301912', colorB: '#7f3826', displacement: -0.022, maskFrom: 'brick-tiles'
  }, 'fx-edge-damage'),
  node('dirt', 'subgraph', 'Mortar Dirt', 740, 190, { amount: 0.42 }, {
    kind: 'fbm', channel: 'roughness', blendMode: 'multiply', opacity: 0.28, scale: 6.4, seed: 75,
    colorA: '#251f1a', colorB: '#66594d', roughness: 0.2
  }, 'fx-dirt-accumulation'),
  node('output', 'output', 'PBR Output', 920, 120)
], [
  { id: 'brick-scale', label: 'Brick Scale', nodeId: 'brick-tiles', parameter: 'xAmount', type: 'float', defaultValue: 7, min: 2, max: 16, step: 1 },
  { id: 'mortar-gap', label: 'Mortar Width', nodeId: 'brick-tiles', parameter: 'gap', type: 'float', defaultValue: 0.095, min: 0.02, max: 0.24, step: 0.005 },
  { id: 'damage', label: 'Damage', nodeId: 'edge-damage', parameter: 'amount', type: 'float', defaultValue: 0.35, min: 0, max: 1, step: 0.01 }
]);

const GRASS_GRAPH = graph('designer-dense-grass', 'Designer · Dense Grass', [
  node('soil', 'noise', 'Soil', 0, 0, { scale: 3 }, {
    kind: 'fbm', channel: 'surface', blendMode: 'normal', scale: 3.2, strength: 1.25, seed: 7,
    colorA: '#1f2415', colorB: '#4a4b27', roughness: 0.18, displacement: 0.018
  }),
  node('blade', 'shape', 'Grass Blade Shape', 0, 120, { shape: 'tapered-capsule' }),
  node('splatter', 'shape-splatter', 'Blade Splatter', 200, 120, { density: 1.45, clump: 0.6 }, {
    kind: 'pattern', channel: 'surface', blendMode: 'overlay', opacity: 0.9, scale: 9.2, strength: 1.65, seed: 28,
    colorA: '#24451f', colorB: '#78a848', roughness: -0.04, displacement: 0.042,
    pattern: { kind: 'grass', aspect: 0.22, gap: 0.035, roundness: 0.2, jitter: 0.8, rotation: 0.18, density: 1.65, edgeWear: 0.08 }
  }),
  node('flood', 'flood-fill', 'Blade IDs', 390, 120),
  node('variation', 'color-variation', 'Blade Color Variation', 560, 120, { amount: 0.35 }, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.34, scale: 9.2, seed: 44,
    colorA: '#182d16', colorB: '#a0b95a', structureFrom: 'splatter',
    pattern: { kind: 'grass', aspect: 0.22, gap: 0.035, roundness: 0.2, jitter: 0.8, rotation: 0.18, density: 1.65 }
  }),
  node('dead', 'shape-splatter', 'Dry Blades', 560, 220, { density: 0.18 }, {
    kind: 'spots', channel: 'color', blendMode: 'overlay', opacity: 0.22, scale: 13.5, seed: 76,
    colorA: '#5e572b', colorB: '#a49b55'
  }),
  node('output', 'output', 'PBR Output', 760, 140)
], [
  { id: 'density', label: 'Blade Density', nodeId: 'splatter', parameter: 'density', type: 'float', defaultValue: 1.45, min: 0.2, max: 3, step: 0.05 },
  { id: 'clump', label: 'Clumping', nodeId: 'splatter', parameter: 'clump', type: 'float', defaultValue: 0.6, min: 0, max: 1, step: 0.01 }
]);

const GRAVEL_GRAPH = graph('designer-river-gravel', 'Designer · River Gravel', [
  node('bed', 'noise', 'Fine Bed', 0, 0, { scale: 5 }, {
    kind: 'fbm', channel: 'surface', blendMode: 'normal', scale: 5.2, seed: 3,
    colorA: '#34312d', colorB: '#6f675d', roughness: 0.2, displacement: 0.012
  }),
  node('pebble', 'sdf', 'Pebble SDF', 0, 120, { shape: 'rounded-pebble' }),
  node('scatter', 'shape-splatter', 'Pebble Splatter', 190, 120, { density: 1.1 }, {
    kind: 'pattern', channel: 'surface', blendMode: 'overlay', opacity: 0.92, scale: 6.5, strength: 1.75, seed: 33,
    colorA: '#49433c', colorB: '#a49a89', roughness: 0.06, displacement: 0.07,
    pattern: { kind: 'pebble', aspect: 1.2, gap: 0.1, roundness: 0.38, jitter: 0.85, rotation: 0.8, density: 1.2, edgeWear: 0.15 }
  }),
  node('flood', 'flood-fill', 'Pebble IDs', 370, 120),
  node('random', 'flood-random', 'Pebble Random', 540, 120, {}, {
    kind: 'pattern', channel: 'color', blendMode: 'overlay', opacity: 0.42, scale: 6.5, seed: 68,
    colorA: '#2f3233', colorB: '#c4ab86', structureFrom: 'scatter',
    pattern: { kind: 'pebble', aspect: 1.2, gap: 0.1, roundness: 0.38, jitter: 0.85, rotation: 0.8, density: 1.2 }
  }),
  node('wet', 'levels', 'Wet Cavities', 540, 220, {}, {
    kind: 'wet-film', channel: 'clearcoat', opacity: 0.34, scale: 4.4, seed: 84, colorA: '#263137', colorB: '#d9e8ef', roughness: -0.18
  }),
  node('output', 'output', 'PBR Output', 740, 140)
]);

const ROOF_GRAPH = graph('designer-clay-roof-tiles', 'Designer · Clay Roof Tiles', [
  node('underlay', 'noise', 'Dark Underlay', 0, 0, {}, {
    kind: 'base', channel: 'surface', blendMode: 'normal', colorA: '#30231d', colorB: '#544036', roughness: 0.15
  }),
  node('tile-shape', 'sdf', 'Curved Roof Tile', 0, 100, { profile: 'barrel' }),
  node('sampler', 'tile-sampler', 'Overlapping Roof Tiles', 200, 100, { bond: 'stack', overlap: 0.28 }, {
    kind: 'pattern', channel: 'surface', opacity: 0.95, scale: 4.6, strength: 1.7, seed: 18,
    colorA: '#6d3020', colorB: '#bd6b3e', roughness: 0.08, displacement: 0.082,
    pattern: { kind: 'roof-tile', aspect: 0.72, gap: 0.035, roundness: 0.32, jitter: 0.08, offset: 0.5, edgeWear: 0.12 }
  }),
  node('variation', 'flood-random', 'Tile Variation', 400, 100, {}, {
    kind: 'pattern', channel: 'color', opacity: 0.31, scale: 4.6, seed: 42,
    colorA: '#492019', colorB: '#d98b54', structureFrom: 'sampler',
    pattern: { kind: 'roof-tile', aspect: 0.72, gap: 0.035, roundness: 0.32, jitter: 0.08, offset: 0.5 }
  }),
  node('weather', 'subgraph', 'Weathering', 590, 180, {}, {
    kind: 'fbm', channel: 'roughness', opacity: 0.24, scale: 8.5, seed: 72, colorA: '#2c281f', colorB: '#8c7f65', roughness: 0.22
  }, 'fx-dirt-accumulation'),
  node('output', 'output', 'PBR Output', 780, 110)
]);

const WOOD_GRAPH = graph('designer-weathered-planks', 'Designer · Weathered Wood Planks', [
  node('wood-base', 'noise', 'Wood Base', 0, 0, {}, {
    kind: 'base', channel: 'surface', blendMode: 'normal', colorA: '#39271d', colorB: '#6c4930', roughness: 0.14
  }),
  node('planks', 'tile-sampler', 'Plank Layout', 180, 0, { bond: 'running' }, {
    kind: 'pattern', channel: 'height', opacity: 0.9, scale: 3.6, strength: 1.35, seed: 9,
    colorA: '#3a291e', colorB: '#745236', displacement: 0.038,
    pattern: { kind: 'plank', aspect: 5.2, gap: 0.045, roundness: 0.06, jitter: 0.12, offset: 0.5, edgeWear: 0.2 }
  }),
  node('grain', 'directional-warp', 'Long Grain', 360, 0, { direction: 0 }, {
    kind: 'veins', channel: 'color', blendMode: 'overlay', opacity: 0.45, scale: 7.5, strength: 1.15, seed: 31,
    colorA: '#241810', colorB: '#a2794d', roughness: 0.04, structureFrom: 'planks'
  }),
  node('cracks', 'edge-detect', 'Dry Cracks', 540, 80, {}, {
    kind: 'ridges', channel: 'height', opacity: 0.22, scale: 15, strength: 1.75, seed: 65,
    colorA: '#15100c', colorB: '#6b5844', displacement: -0.018
  }),
  node('output', 'output', 'PBR Output', 730, 20)
]);

const CERAMIC_GRAPH = graph('designer-ceramic-tiles', 'Designer · Ceramic Tiles', [
  node('grout', 'shape', 'Grout', 0, 0, {}, {
    kind: 'base', channel: 'surface', colorA: '#8a8982', colorB: '#aaa79d', roughness: 0.16
  }),
  node('tiles', 'tile-sampler', 'Ceramic Tile Grid', 190, 0, { bond: 'stack' }, {
    kind: 'pattern', channel: 'surface', opacity: 0.96, scale: 4.5, strength: 1.5, seed: 13,
    colorA: '#31576b', colorB: '#80a8b4', roughness: -0.08, displacement: 0.028,
    pattern: { kind: 'tile', aspect: 1, gap: 0.07, roundness: 0.1, jitter: 0.03, edgeWear: 0.04 }
  }),
  node('glaze', 'levels', 'Glaze', 390, 0, {}, {
    kind: 'pattern', channel: 'clearcoat', opacity: 0.72, scale: 4.5, strength: 1, seed: 13,
    colorA: '#5b7d89', colorB: '#e7f6f8', structureFrom: 'tiles', roughness: -0.28,
    pattern: { kind: 'tile', aspect: 1, gap: 0.07, roundness: 0.1, jitter: 0.03 }
  }),
  node('output', 'output', 'PBR Output', 580, 0)
]);

const FABRIC_GRAPH = graph('designer-woven-fabric', 'Designer · Woven Fabric', [
  node('base', 'shape', 'Fabric Base', 0, 0, {}, {
    kind: 'base', channel: 'surface', colorA: '#2e3134', colorB: '#50565b', roughness: 0.24
  }),
  node('weave', 'tile-sampler', 'Warp & Weft', 180, 0, { weave: 'plain' }, {
    kind: 'pattern', channel: 'surface', opacity: 0.78, scale: 14, strength: 1.35, seed: 22,
    colorA: '#33373b', colorB: '#899198', roughness: 0.16, displacement: 0.012,
    pattern: { kind: 'fabric', aspect: 1, gap: 0.08, roundness: 0.32, jitter: 0.05, density: 1.4 }
  }),
  node('fiber', 'noise', 'Fiber Breakup', 360, 80, {}, {
    kind: 'fbm', channel: 'roughness', opacity: 0.26, scale: 18, seed: 59, colorA: '#1c2023', colorB: '#8e969b', roughness: 0.18
  }),
  node('output', 'output', 'PBR Output', 550, 0)
]);

const CONCRETE_GRAPH = graph('designer-weathered-concrete', 'Designer · Weathered Concrete', [
  node('base', 'noise', 'Cement Body', 0, 0, {}, {
    kind: 'base', channel: 'surface', colorA: '#62635f', colorB: '#8e8e87', roughness: 0.2
  }),
  node('aggregate', 'shape-splatter', 'Fine Aggregate', 180, 0, { density: 1.8 }, {
    kind: 'cellular', channel: 'surface', opacity: 0.35, scale: 11, seed: 27, colorA: '#424540', colorB: '#a1a095', displacement: 0.014
  }),
  node('pores', 'shape-splatter', 'Pores', 360, 0, { density: 0.32 }, {
    kind: 'spots', channel: 'height', opacity: 0.32, scale: 14, strength: 1.8, seed: 48, colorA: '#292b28', colorB: '#686a64', displacement: -0.022
  }),
  node('stains', 'subgraph', 'Water Stains', 540, 100, {}, {
    kind: 'gradient', channel: 'color', opacity: 0.16, scale: 1, seed: 72, colorA: '#3f4440', colorB: '#8e9289'
  }, 'fx-dirt-accumulation'),
  node('output', 'output', 'PBR Output', 720, 0)
]);

const PLASTER_GRAPH = graph('designer-aged-plaster', 'Designer · Aged Plaster', [
  node('base', 'noise', 'Plaster Body', 0, 0, {}, {
    kind: 'base', channel: 'surface', colorA: '#c5bba3', colorB: '#e0d8c5', roughness: 0.19
  }),
  node('trowel', 'directional-warp', 'Trowel Marks', 180, 0, {}, {
    kind: 'ridges', channel: 'surface', opacity: 0.28, scale: 7.2, strength: 1.2, seed: 25, colorA: '#9e927c', colorB: '#e4dcc9', displacement: 0.012
  }),
  node('pits', 'shape-splatter', 'Small Pits', 360, 0, {}, {
    kind: 'spots', channel: 'height', opacity: 0.22, scale: 13, strength: 1.7, seed: 51, colorA: '#6d665a', colorB: '#b9b09c', displacement: -0.015
  }),
  node('cracks', 'subgraph', 'Age Cracks', 540, 80, {}, {
    kind: 'veins', channel: 'color', opacity: 0.14, scale: 5.8, strength: 1.6, seed: 77, colorA: '#575149', colorB: '#cabfa9'
  }, 'fx-edge-damage'),
  node('output', 'output', 'PBR Output', 720, 0)
]);

const ASPHALT_GRAPH = graph('designer-road-asphalt', 'Designer · Road Asphalt', [
  node('binder', 'noise', 'Bitumen Binder', 0, 0, {}, {
    kind: 'base', channel: 'surface', colorA: '#151719', colorB: '#282b2d', roughness: 0.23
  }),
  node('aggregate', 'shape-splatter', 'Stone Aggregate', 180, 0, { density: 2.1 }, {
    kind: 'pattern', channel: 'surface', opacity: 0.72, scale: 12, strength: 1.55, seed: 36,
    colorA: '#282a29', colorB: '#64635f', roughness: 0.16, displacement: 0.018,
    pattern: { kind: 'pebble', aspect: 1.1, gap: 0.055, roundness: 0.36, jitter: 0.95, density: 2.2, edgeWear: 0.3 }
  }),
  node('fine', 'noise', 'Fine Grain', 360, 80, {}, {
    kind: 'fbm', channel: 'roughness', opacity: 0.3, scale: 18, seed: 67, colorA: '#111315', colorB: '#45484a', roughness: 0.17
  }),
  node('output', 'output', 'PBR Output', 550, 0)
]);

const COBBLE_GRAPH = graph('designer-cobblestone', 'Designer · Cobblestone', [
  node('mortar', 'noise', 'Packed Mortar', 0, 0, {}, {
    kind: 'base', channel: 'surface', colorA: '#4a4944', colorB: '#747168', roughness: 0.2
  }),
  node('stones', 'shape-splatter', 'Cobble Splatter', 190, 0, { density: 1.25 }, {
    kind: 'pattern', channel: 'surface', opacity: 0.94, scale: 5.2, strength: 1.75, seed: 41,
    colorA: '#3f4442', colorB: '#9b9688', roughness: 0.08, displacement: 0.09,
    pattern: { kind: 'pebble', aspect: 1.35, gap: 0.085, roundness: 0.42, jitter: 0.9, density: 1.15, edgeWear: 0.24 }
  }),
  node('variation', 'flood-random', 'Stone Variation', 380, 0, {}, {
    kind: 'pattern', channel: 'color', opacity: 0.38, scale: 5.2, seed: 81,
    colorA: '#343938', colorB: '#b4a98f', structureFrom: 'stones',
    pattern: { kind: 'pebble', aspect: 1.35, gap: 0.085, roundness: 0.42, jitter: 0.9, density: 1.15 }
  }),
  node('moss', 'subgraph', 'Moss in Gaps', 560, 100, {}, {
    kind: 'fbm', channel: 'color', opacity: 0.18, scale: 9, seed: 92, colorA: '#20321e', colorB: '#607044', maskFrom: 'stones', maskInvert: true, maskStrength: 0.8
  }, 'fx-moss-growth'),
  node('output', 'output', 'PBR Output', 740, 0)
]);

export const SURFACE_DESIGNER_PRESETS: readonly MaterialPreset[] = [
  makePreset(BRICK_GRAPH, 'Running-bond masonry with mortar, per-brick variation, chipped edges and dirt accumulation.', ['brick', 'masonry', 'construction'], { roughness: 0.68, clearcoat: 0.03, clearcoatRoughness: 0.72 }, { age: 0.42, weathering: 0.5, variation: 0.44 }),
  makePreset(GRASS_GRAPH, 'Dense layered turf built from a blade splatter over visible soil with dead-blade variation.', ['grass', 'ground', 'organic'], { roughness: 0.78, sheen: 0.08, sheenRoughness: 0.72 }, { variation: 0.58, stochasticTiling: 0.2 }),
  makePreset(GRAVEL_GRAPH, 'Rounded river pebbles with individual color variation, fine bed material and wet cavities.', ['gravel', 'stone', 'ground'], { roughness: 0.58, clearcoat: 0.12, clearcoatRoughness: 0.22 }, { variation: 0.55, stochasticTiling: 0.28 }),
  makePreset(ROOF_GRAPH, 'Overlapping weathered clay roof tiles with controlled curvature and per-tile variation.', ['roof', 'tile', 'construction'], { roughness: 0.6, clearcoat: 0.05, clearcoatRoughness: 0.62 }, { age: 0.24, weathering: 0.36 }),
  makePreset(WOOD_GRAPH, 'Weathered plank layout with long grain, seams and dry cracking.', ['wood', 'plank', 'construction'], { roughness: 0.62, sheen: 0.03 }, { age: 0.38, weathering: 0.4, variation: 0.4 }),
  makePreset(CERAMIC_GRAPH, 'Clean ceramic tile grid with recessed grout and a procedural glossy glaze.', ['ceramic', 'tile', 'interior'], { roughness: 0.24, clearcoat: 0.72, clearcoatRoughness: 0.14, specularIntensity: 0.72 }, { variation: 0.12 }),
  makePreset(FABRIC_GRAPH, 'Fine woven fabric with warp-and-weft relief and fiber roughness breakup.', ['fabric', 'woven', 'interior'], { roughness: 0.7, sheen: 0.48, sheenRoughness: 0.62, sheenColor: '#bfc7cc' }, { variation: 0.24 }),
  makePreset(CONCRETE_GRAPH, 'Weathered concrete with aggregate, pores, stains and coherent height variation.', ['concrete', 'construction'], { roughness: 0.74, clearcoat: 0 }, { age: 0.35, weathering: 0.42, variation: 0.45 }),
  makePreset(PLASTER_GRAPH, 'Troweled aged plaster with pits, subtle cracks and broad surface variation.', ['plaster', 'wall', 'construction'], { roughness: 0.71, clearcoat: 0 }, { age: 0.4, weathering: 0.33, variation: 0.36 }),
  makePreset(ASPHALT_GRAPH, 'Dense road asphalt with procedural aggregate, binder and fine roughness grain.', ['asphalt', 'road', 'ground'], { roughness: 0.82 }, { variation: 0.48, stochasticTiling: 0.24 }),
  makePreset(COBBLE_GRAPH, 'Irregular cobblestones with individual stone variation, mortar and moss in protected gaps.', ['cobblestone', 'stone', 'construction'], { roughness: 0.7, clearcoat: 0.04 }, { age: 0.46, weathering: 0.52, variation: 0.58 })
];

/**
 * Compiles every designer preset and returns their graphs. Deliberately a function, not
 * a module-level constant: as a constant it forced all eleven compilations during boot.
 */
export function surfaceDesignerGraphs(): readonly SurfaceGraphDefinition[] {
  return SURFACE_DESIGNER_PRESETS
    .map((preset) => preset.graph)
    .filter((item): item is SurfaceGraphDefinition => item !== undefined);
}
