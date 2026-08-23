import type { SurfaceGraphDefinition } from '../core/graph/SurfaceGraph';
import type { PatternSettings } from '../core/material/PatternSettings';

export type LayerKind =
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

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'add'
  | 'screen'
  | 'overlay';

export type LayerChannel =
  | 'surface'
  | 'color'
  | 'roughness'
  | 'height'
  | 'clearcoat'
  | 'sss'
  | 'metallic'
  | 'ao'
  | 'emissive';

export type EnvironmentPreset =
  | 'studio'
  | 'warm'
  | 'cool'
  | 'night'
  | 'custom';

export type ObjectPreset =
  | 'sphere'
  | 'icosphere'
  | 'cube'
  | 'rounded-cube'
  | 'torus'
  | 'plane'
  | 'cylinder'
  | 'cone'
  | 'capsule'
  | 'octahedron'
  | 'dodecahedron'
  | 'torus-knot';

export interface MaterialLayer {
  id: string;
  name: string;
  kind: LayerKind;
  enabled: boolean;
  blendMode: BlendMode;
  channel: LayerChannel;
  opacity: number;
  scale: number;
  strength: number;
  seed: number;
  colorA: string;
  colorB: string;
  roughness: number;
  displacement: number;
  groupId: string | null;
  maskSourceLayerId: string | null;
  structureSourceLayerId: string | null;
  maskInvert: boolean;
  maskStrength: number;
  pattern?: PatternSettings | null;
}

export interface SynthesisSettings {
  age: number;
  weathering: number;
  gravity: number;
  macro: number;
  meso: number;
  micro: number;
  variation: number;
  stochasticTiling: number;
}

export interface GenomeLocks {
  color: boolean;
  structure: boolean;
  roughness: boolean;
  scale: boolean;
  damage: boolean;
}

export interface MaterialGroup {
  id: string;
  name: string;
  parentId: string | null;
  enabled: boolean;
  opacity: number;
}

export interface ImportedMeshTarget {
  id: string;
  label: string;
}

export interface PhysicalSettings {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
  ior: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  transmission: number;
  thickness: number;
  attenuationDistance: number;
  attenuationColor: string;
}

export interface ProjectState {
  version: 2;
  selectedObject: ObjectPreset;
  selectedLayerId: string | null;
  importedAssetName: string | null;
  importedMeshes: ImportedMeshTarget[];
  selectedMeshId: string | null;
  meshAssignments: Record<string, boolean>;
  environment: EnvironmentPreset;
  environmentAssetName: string | null;
  background: string;
  wireframe: boolean;
  physical: PhysicalSettings;
  synthesis: SynthesisSettings;
  genomeLocks: GenomeLocks;
  graphMode: boolean;
  surfaceGraph?: SurfaceGraphDefinition | null;
  groups: MaterialGroup[];
  layers: MaterialLayer[];
}

export interface MaterialPreset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  physical?: Partial<PhysicalSettings>;
  synthesis?: Partial<SynthesisSettings>;
  groups?: MaterialGroup[];
  layers: MaterialLayer[];
  graph?: SurfaceGraphDefinition;
}
