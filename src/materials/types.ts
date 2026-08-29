import type { SurfaceGraphDefinition } from '../core/graph/SurfaceGraph';
import type {
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';

export type {
  BlendMode,
  LayerChannel,
  LayerKind,
  MaskMode,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  RuntimeMaterialDefinition,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';

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

export interface GenomeLocks {
  color: boolean;
  structure: boolean;
  roughness: boolean;
  scale: boolean;
  damage: boolean;
}

export interface ImportedMeshTarget {
  id: string;
  label: string;
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
