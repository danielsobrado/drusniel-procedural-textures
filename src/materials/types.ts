export type LayerKind =
  | 'base'
  | 'fbm'
  | 'cellular'
  | 'ridges'
  | 'spots'
  | 'veins'
  | 'gradient';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'add'
  | 'screen'
  | 'overlay';

export type ObjectPreset =
  | 'sphere'
  | 'icosphere'
  | 'cube'
  | 'rounded-cube'
  | 'torus'
  | 'plane';

export interface MaterialLayer {
  id: string;
  name: string;
  kind: LayerKind;
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number;
  scale: number;
  strength: number;
  seed: number;
  colorA: string;
  colorB: string;
  roughness: number;
  displacement: number;
}

export interface PhysicalSettings {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
  ior: number;
}

export interface ProjectState {
  version: 1;
  selectedObject: ObjectPreset;
  selectedLayerId: string | null;
  importedAssetName: string | null;
  background: string;
  wireframe: boolean;
  physical: PhysicalSettings;
  layers: MaterialLayer[];
}

export interface MaterialPreset {
  id: string;
  name: string;
  description: string;
  physical?: Partial<PhysicalSettings>;
  layers: MaterialLayer[];
}
