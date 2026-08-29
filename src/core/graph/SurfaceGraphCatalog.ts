import type { SurfaceGraphNodeKind, SurfaceGraphValueType } from './SurfaceGraph';

export type SurfaceGraphNodeCategory =
  | 'generator'
  | 'scatter'
  | 'flood'
  | 'height'
  | 'warp'
  | 'adjust'
  | 'transform'
  | 'blend'
  | 'utility'
  | 'sdf'
  | 'graph'
  | 'output';

export interface SurfaceGraphPortSpec {
  name: string;
  type: SurfaceGraphValueType;
  optional?: boolean;
}

/**
 * How faithfully a kind's lowering reproduces the operation its label promises.
 *
 * `stable`  - lowers to the operation it names.
 * `preview` - lowers to a related procedural layer that approximates it.
 * `planned` - has no lowering of its own yet and contributes nothing.
 *
 * This governs catalog visibility only. Every kind stays valid in the schema, because recipes
 * already in the wild reference them and narrowing the schema would break import.
 */
export type SurfaceGraphNodeStatus = 'stable' | 'preview' | 'planned';

export interface SurfaceGraphNodeSpec {
  kind: SurfaceGraphNodeKind;
  label: string;
  category: SurfaceGraphNodeCategory;
  inputs: readonly SurfaceGraphPortSpec[];
  outputs: readonly SurfaceGraphPortSpec[];
  status: SurfaceGraphNodeStatus;
}

type SurfaceGraphNodeSpecSource = Omit<SurfaceGraphNodeSpec, 'status'>;

/** Lowers to a related layer that reads as the operation without performing it. */
const PREVIEW_KINDS = new Set<SurfaceGraphNodeKind>([
  'flood-fill', 'flood-random', 'flood-index', 'flood-gradient', 'flood-position',
  'gradient-map', 'rgb-to-hsl', 'hsl-adjust', 'color-variation', 'height-to-ao'
]);

/**
 * Declared but not implemented. Mirrors HEIGHT_KINDS in SurfaceGraphRuntimeLowering; the two are
 * held in step by tests/surface-graph-node-status.test.ts.
 */
const PLANNED_KINDS = new Set<SurfaceGraphNodeKind>([
  'bevel', 'slope-blur', 'blur', 'non-uniform-blur', 'distance', 'edge-detect', 'curvature',
  'emboss', 'sharpen', 'height-select', 'warp', 'directional-warp', 'vector-warp',
  'multi-direction-warp', 'swirl', 'slope-warp', 'levels', 'histogram-scan', 'histogram-range',
  'clamp', 'contrast', 'posterize', 'quantize', 'invert', 'transform-2d', 'mirror', 'symmetry',
  'tile', 'polar-transform', 'height-to-normal', 'height-to-curvature', 'height-to-slope',
  'height-to-edge', 'height-to-cavity', 'normal-combine', 'normal-blend', 'normal-rotate'
]);

function statusFor(kind: SurfaceGraphNodeKind): SurfaceGraphNodeStatus {
  if (PLANNED_KINDS.has(kind)) return 'planned';
  if (PREVIEW_KINDS.has(kind)) return 'preview';
  return 'stable';
}

const scalar = (name: string, optional = false): SurfaceGraphPortSpec => ({ name, type: 'float', optional });
const height = (name = 'height', optional = false): SurfaceGraphPortSpec => ({ name, type: 'height', optional });
const mask = (name = 'mask', optional = false): SurfaceGraphPortSpec => ({ name, type: 'mask', optional });
const color = (name = 'color', optional = false): SurfaceGraphPortSpec => ({ name, type: 'color', optional });
const normal = (name = 'normal', optional = false): SurfaceGraphPortSpec => ({ name, type: 'normal', optional });
const id = (name = 'id', optional = false): SurfaceGraphPortSpec => ({ name, type: 'id', optional });

const NODE_SPEC_SOURCES: readonly SurfaceGraphNodeSpecSource[] = [
  { kind: 'shape', label: 'Shape', category: 'generator', inputs: [], outputs: [height()] },
  { kind: 'noise', label: 'Noise', category: 'generator', inputs: [], outputs: [height()] },
  { kind: 'texture-field', label: 'Texture Field', category: 'generator', inputs: [], outputs: [height(), mask(), scalar('value'), color()] },
  { kind: 'tile-sampler', label: 'Tile Sampler', category: 'scatter', inputs: [height('pattern', true), mask('density', true), scalar('scale', true), scalar('rotation', true)], outputs: [height(), id()] },
  { kind: 'shape-splatter', label: 'Shape Splatter', category: 'scatter', inputs: [height('shape', true), mask('density', true), scalar('scale', true), scalar('rotation', true)], outputs: [height(), id(), mask()] },
  { kind: 'flood-fill', label: 'Flood Fill', category: 'flood', inputs: [height()], outputs: [id()] },
  { kind: 'flood-random', label: 'Flood Fill Random', category: 'flood', inputs: [id()], outputs: [scalar('value')] },
  { kind: 'flood-gradient', label: 'Flood Fill Gradient', category: 'flood', inputs: [id()], outputs: [scalar('value')] },
  { kind: 'flood-position', label: 'Flood Fill Position', category: 'flood', inputs: [id()], outputs: [{ name: 'position', type: 'vector2' }] },
  { kind: 'flood-index', label: 'Flood Fill Index', category: 'flood', inputs: [id()], outputs: [scalar('value')] },
  { kind: 'bevel', label: 'Bevel', category: 'height', inputs: [height()], outputs: [height()] },
  { kind: 'slope-blur', label: 'Slope Blur', category: 'height', inputs: [height(), height('slope', true)], outputs: [height()] },
  { kind: 'blur', label: 'Blur', category: 'height', inputs: [height()], outputs: [height()] },
  { kind: 'non-uniform-blur', label: 'Non-uniform Blur', category: 'height', inputs: [height(), mask('intensity', true)], outputs: [height()] },
  { kind: 'distance', label: 'Distance', category: 'height', inputs: [mask()], outputs: [height()] },
  { kind: 'edge-detect', label: 'Edge Detect', category: 'height', inputs: [height()], outputs: [mask()] },
  { kind: 'curvature', label: 'Curvature', category: 'height', inputs: [height()], outputs: [mask('convex'), mask('concave')] },
  { kind: 'emboss', label: 'Emboss', category: 'height', inputs: [height()], outputs: [height()] },
  { kind: 'sharpen', label: 'Sharpen', category: 'height', inputs: [height()], outputs: [height()] },
  { kind: 'height-blend', label: 'Height Blend', category: 'height', inputs: [height('base'), height('top'), mask('opacity', true)], outputs: [height(), mask()] },
  { kind: 'height-select', label: 'Height Select', category: 'height', inputs: [height()], outputs: [mask()] },
  { kind: 'warp', label: 'Warp', category: 'warp', inputs: [height('source'), height('intensity')], outputs: [height()] },
  { kind: 'directional-warp', label: 'Directional Warp', category: 'warp', inputs: [height('source'), height('intensity')], outputs: [height()] },
  { kind: 'vector-warp', label: 'Vector Warp', category: 'warp', inputs: [height('source'), { name: 'vector', type: 'vector2' }], outputs: [height()] },
  { kind: 'multi-direction-warp', label: 'Multi-direction Warp', category: 'warp', inputs: [height('source'), height('intensity')], outputs: [height()] },
  { kind: 'swirl', label: 'Swirl', category: 'warp', inputs: [height()], outputs: [height()] },
  { kind: 'slope-warp', label: 'Slope Warp', category: 'warp', inputs: [height('source'), height('slope')], outputs: [height()] },
  { kind: 'levels', label: 'Levels', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'histogram-scan', label: 'Histogram Scan', category: 'adjust', inputs: [height()], outputs: [mask()] },
  { kind: 'histogram-range', label: 'Histogram Range', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'clamp', label: 'Clamp', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'contrast', label: 'Contrast', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'gradient-map', label: 'Gradient Map', category: 'adjust', inputs: [height()], outputs: [color()] },
  { kind: 'posterize', label: 'Posterize', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'quantize', label: 'Quantize', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'invert', label: 'Invert', category: 'adjust', inputs: [height()], outputs: [height()] },
  { kind: 'transform-2d', label: 'Transform 2D', category: 'transform', inputs: [height()], outputs: [height()] },
  { kind: 'mirror', label: 'Mirror', category: 'transform', inputs: [height()], outputs: [height()] },
  { kind: 'symmetry', label: 'Symmetry', category: 'transform', inputs: [height()], outputs: [height()] },
  { kind: 'tile', label: 'Tile', category: 'transform', inputs: [height()], outputs: [height()] },
  { kind: 'polar-transform', label: 'Polar Transform', category: 'transform', inputs: [height()], outputs: [height()] },
  { kind: 'blend', label: 'Blend', category: 'blend', inputs: [height('background'), height('foreground'), mask('opacity', true)], outputs: [height()] },
  { kind: 'min', label: 'Min', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'max', label: 'Max', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'multiply', label: 'Multiply', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'add', label: 'Add', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'subtract', label: 'Subtract', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'overlay', label: 'Overlay', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'screen', label: 'Screen', category: 'blend', inputs: [height('a'), height('b')], outputs: [height()] },
  { kind: 'height-to-normal', label: 'Height to Normal', category: 'utility', inputs: [height()], outputs: [normal()] },
  { kind: 'height-to-curvature', label: 'Height to Curvature', category: 'utility', inputs: [height()], outputs: [mask()] },
  { kind: 'height-to-ao', label: 'Height to AO', category: 'utility', inputs: [height()], outputs: [mask()] },
  { kind: 'height-to-slope', label: 'Height to Slope', category: 'utility', inputs: [height()], outputs: [mask()] },
  { kind: 'height-to-edge', label: 'Height to Edge', category: 'utility', inputs: [height()], outputs: [mask()] },
  { kind: 'height-to-cavity', label: 'Height to Cavity', category: 'utility', inputs: [height()], outputs: [mask()] },
  { kind: 'normal-combine', label: 'Normal Combine', category: 'utility', inputs: [normal('a'), normal('b')], outputs: [normal()] },
  { kind: 'normal-blend', label: 'Normal Blend', category: 'utility', inputs: [normal('a'), normal('b'), mask('opacity', true)], outputs: [normal()] },
  { kind: 'normal-rotate', label: 'Normal Rotate', category: 'utility', inputs: [normal()], outputs: [normal()] },
  { kind: 'rgb-to-hsl', label: 'RGB to HSL', category: 'utility', inputs: [color()], outputs: [color('hsl')] },
  { kind: 'hsl-adjust', label: 'HSL Adjust', category: 'utility', inputs: [color()], outputs: [color()] },
  { kind: 'color-variation', label: 'Color Variation', category: 'utility', inputs: [color(), id('id', true)], outputs: [color()] },
  { kind: 'sdf', label: 'SDF Shape', category: 'sdf', inputs: [height('a', true), height('b', true)], outputs: [height()] },
  { kind: 'subgraph', label: 'Subgraph', category: 'graph', inputs: [height('input', true)], outputs: [height('output')] },
  { kind: 'output', label: 'Material Output', category: 'output', inputs: [color('baseColor', true), scalar('roughness', true), scalar('metallic', true), normal('normal', true), height('height', true), scalar('ao', true), color('emissive', true), scalar('opacity', true), scalar('clearcoat', true), scalar('sss', true)], outputs: [{ name: 'material', type: 'material' }] }
] as const;

export const SURFACE_GRAPH_NODE_SPECS: readonly SurfaceGraphNodeSpec[] =
  NODE_SPEC_SOURCES.map((spec) => ({ ...spec, status: statusFor(spec.kind) }));

export const SURFACE_GRAPH_NODE_SPEC_BY_KIND = new Map(
  SURFACE_GRAPH_NODE_SPECS.map((spec) => [spec.kind, spec] as const)
);
