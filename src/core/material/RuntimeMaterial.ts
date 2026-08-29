import type { SurfaceGraphDefinition } from '../graph/SurfaceGraph';
import type { TextureFieldSettings } from '../texture/TextureFieldSettings';
import type { PatternSettings } from './PatternSettings';

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

export type BlendMode = 'normal' | 'multiply' | 'add' | 'screen' | 'overlay';

/**
 * How a layer's mask source is shaped. `coverage` consumes the source generator's field
 * linearly. `height` thresholds the source's relief, so the masked layer settles into the
 * source's crevices — moss in mortar, dirt in seams, snow on ledges.
 */
export type MaskMode = 'coverage' | 'height';

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
  maskMode: MaskMode;
  maskThreshold: number;
  maskSoftness: number;
  maskBreakup: number;
  pattern?: PatternSettings | null;
  texture?: TextureFieldSettings | null;
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

export interface MaterialGroup {
  id: string;
  name: string;
  parentId: string | null;
  enabled: boolean;
  opacity: number;
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

/** Portable authored material state. Lab viewport, selection and import state are excluded. */
export interface RuntimeMaterialDefinition {
  physical: PhysicalSettings;
  synthesis: SynthesisSettings;
  groups: MaterialGroup[];
  layers: MaterialLayer[];
  surfaceGraph?: SurfaceGraphDefinition | null;
}
