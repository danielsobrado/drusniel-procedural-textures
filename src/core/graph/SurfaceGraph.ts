import type { TextureFieldSettings } from '../texture/TextureFieldSettings';

export type SurfaceGraphValueType =
  | 'float'
  | 'color'
  | 'vector2'
  | 'vector3'
  | 'mask'
  | 'height'
  | 'normal'
  | 'id'
  | 'material';

export type SurfaceGraphNodeKind =
  | 'shape'
  | 'noise'
  | 'texture-field'
  | 'tile-sampler'
  | 'shape-splatter'
  | 'flood-fill'
  | 'flood-random'
  | 'flood-gradient'
  | 'flood-position'
  | 'flood-index'
  | 'bevel'
  | 'slope-blur'
  | 'blur'
  | 'non-uniform-blur'
  | 'distance'
  | 'edge-detect'
  | 'curvature'
  | 'emboss'
  | 'sharpen'
  | 'height-blend'
  | 'height-select'
  | 'warp'
  | 'directional-warp'
  | 'vector-warp'
  | 'multi-direction-warp'
  | 'swirl'
  | 'slope-warp'
  | 'levels'
  | 'histogram-scan'
  | 'histogram-range'
  | 'clamp'
  | 'contrast'
  | 'gradient-map'
  | 'posterize'
  | 'quantize'
  | 'invert'
  | 'transform-2d'
  | 'mirror'
  | 'symmetry'
  | 'tile'
  | 'polar-transform'
  | 'blend'
  | 'min'
  | 'max'
  | 'multiply'
  | 'add'
  | 'subtract'
  | 'overlay'
  | 'screen'
  | 'height-to-normal'
  | 'height-to-curvature'
  | 'height-to-ao'
  | 'height-to-slope'
  | 'height-to-edge'
  | 'height-to-cavity'
  | 'normal-combine'
  | 'normal-blend'
  | 'normal-rotate'
  | 'rgb-to-hsl'
  | 'hsl-adjust'
  | 'color-variation'
  | 'sdf'
  | 'subgraph'
  | 'output';

export type SurfaceGraphParameterValue =
  | number
  | string
  | boolean
  | readonly number[]
  | readonly string[];

export interface SurfaceGraphPortRef {
  nodeId: string;
  port: string;
}

export interface SurfaceGraphEdge {
  from: SurfaceGraphPortRef;
  to: SurfaceGraphPortRef;
}

export interface SurfaceGraphPosition {
  x: number;
  y: number;
}

export type SurfaceRuntimeLayerKind =
  | 'base'
  | 'fbm'
  | 'cellular'
  | 'ridges'
  | 'spots'
  | 'veins'
  | 'gradient'
  | 'vessels'
  | 'wet-film'
  | 'sss'
  | 'reaction-diffusion'
  | 'erosion'
  | 'sdf'
  | 'pattern';

export type SurfaceRuntimeChannel =
  | 'surface'
  | 'color'
  | 'roughness'
  | 'height'
  | 'clearcoat'
  | 'sss'
  | 'metallic'
  | 'ao'
  | 'emissive';

export type SurfaceRuntimeBlendMode = 'normal' | 'multiply' | 'add' | 'screen' | 'overlay';

export interface SurfaceRuntimePattern {
  kind: 'brick' | 'tile' | 'plank' | 'grass' | 'turf' | 'pebble' | 'roof-tile' | 'fabric';
  aspect?: number;
  gap?: number;
  roundness?: number;
  jitter?: number;
  rotation?: number;
  offset?: number;
  density?: number;
  edgeWear?: number;
  bladeLength?: number;
  bladeWidth?: number;
  bladeTaper?: number;
  bladeBend?: number;
  bladeCurvature?: number;
  clumpScale?: number;
  clumpStrength?: number;
  directionality?: number;
  dryness?: number;
  tipFade?: number;
  rootDarkening?: number;
  heightJitter?: number;
  widthJitter?: number;
  leanJitter?: number;
  fiberLength?: number;
  fiberWidth?: number;
  fiberBreakup?: number;
  fiberSoftness?: number;
}

export interface SurfaceGraphRuntimeLayer {
  kind: SurfaceRuntimeLayerKind;
  channel?: SurfaceRuntimeChannel;
  blendMode?: SurfaceRuntimeBlendMode;
  opacity?: number;
  scale?: number;
  strength?: number;
  seed?: number;
  colorA?: string;
  colorB?: string;
  roughness?: number;
  displacement?: number;
  groupId?: string | null;
  maskFrom?: string | null;
  structureFrom?: string | null;
  maskInvert?: boolean;
  maskStrength?: number;
  pattern?: SurfaceRuntimePattern | null;
  texture?: TextureFieldSettings | null;
}

export interface SurfaceGraphNode {
  id: string;
  kind: SurfaceGraphNodeKind;
  label: string;
  position: SurfaceGraphPosition;
  params: Record<string, SurfaceGraphParameterValue>;
  runtime?: SurfaceGraphRuntimeLayer;
  subgraphId?: string;
}

export interface SurfaceGraphGroup {
  id: string;
  name: string;
  parentId: string | null;
  enabled: boolean;
  opacity: number;
}

export interface SurfaceGraphExposedParameter {
  id: string;
  label: string;
  nodeId: string;
  parameter: string;
  type: 'float' | 'color' | 'boolean' | 'enum';
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export interface SurfaceGraphOutput {
  channel:
    | 'baseColor'
    | 'roughness'
    | 'metallic'
    | 'normal'
    | 'height'
    | 'ao'
    | 'emissive'
    | 'opacity'
    | 'clearcoat'
    | 'sss';
  source: SurfaceGraphPortRef;
}

export interface SurfaceGraphDefinition {
  version: 1;
  id: string;
  name: string;
  nodes: SurfaceGraphNode[];
  edges: SurfaceGraphEdge[];
  outputs: SurfaceGraphOutput[];
  exposed: SurfaceGraphExposedParameter[];
  groups: SurfaceGraphGroup[];
  subgraphs: SurfaceGraphDefinition[];
}
