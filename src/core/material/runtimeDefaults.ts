import type { PhysicalSettings, SynthesisSettings } from './RuntimeMaterial';
import { RUNTIME_CELLULAR_CONFIG } from './generated/runtimeConfig';

export const PTL_MAX_LAYERS = 12;
export const PTL_MAX_GROUPS = 8;
export const PTL_MAX_GROUP_DEPTH = 4;
export const PTL_MAX_LAYER_NAME_LENGTH = 120;
export const PTL_MAX_GROUP_NAME_LENGTH = 120;

export const PTL_LAYER_LIMITS = {
  opacity: { min: 0, max: 1 },
  scale: { min: 0.1, max: 20 },
  strength: { min: 0, max: 2.5 },
  seed: { min: 0, max: 100 },
  roughness: { min: -0.5, max: 0.5 },
  displacement: { min: -0.18, max: 0.18 },
  maskStrength: { min: 0, max: 1 },
  maskThreshold: { min: 0, max: 1 },
  maskSoftness: { min: 0, max: 1 },
  maskBreakup: { min: 0, max: 1 }
} as const;

export const PTL_DEFAULT_MASK_THRESHOLD = 0.5;
export const PTL_DEFAULT_MASK_SOFTNESS = 0.15;
export const PTL_DEFAULT_MASK_BREAKUP = 0;

export const PTL_GROUP_LIMITS = {
  opacity: { min: 0, max: 1 }
} as const;

export const PTL_PHYSICAL_LIMITS = {
  roughness: { min: 0.02, max: 1 },
  metalness: { min: 0, max: 1 },
  clearcoat: { min: 0, max: 1 },
  clearcoatRoughness: { min: 0, max: 1 },
  specularIntensity: { min: 0, max: 1 },
  ior: { min: 1, max: 2.33 },
  sheen: { min: 0, max: 1 },
  sheenRoughness: { min: 0, max: 1 },
  transmission: { min: 0, max: 1 },
  thickness: { min: 0, max: 3 },
  attenuationDistance: { min: 0.05, max: 10 }
} as const;

export const PTL_SYNTHESIS_LIMITS = {
  age: { min: 0, max: 1 },
  weathering: { min: 0, max: 1 },
  gravity: { min: -1, max: 1 },
  macro: { min: 0.1, max: 2 },
  meso: { min: 0.1, max: 2 },
  micro: { min: 0.1, max: 2 },
  variation: { min: 0, max: 1 },
  stochasticTiling: { min: 0, max: 1 }
} as const;

export const PTL_DEFAULT_PHYSICAL: Readonly<PhysicalSettings> = {
  roughness: 0.34,
  metalness: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.18,
  specularIntensity: 0.62,
  ior: 1.42,
  sheen: 0,
  sheenRoughness: 0.7,
  sheenColor: '#ffffff',
  transmission: 0,
  thickness: 0,
  attenuationDistance: 2,
  attenuationColor: '#ffffff'
};

export const PTL_DEFAULT_SYNTHESIS: Readonly<SynthesisSettings> = {
  age: 0,
  weathering: 0,
  gravity: -1,
  macro: 1,
  meso: 1,
  micro: 1,
  variation: 0.35,
  stochasticTiling: 0
};

export const PTL_SHADER_DEFAULTS = {
  normalStrength: 0.72,
  sssLightDirection: [-0.5206251254511277, 0.6607934284572006, 0.5406491687377095] as const,
  sssBackscatterStrength: 0.68,
  sssThicknessScale: 1.15
} as const;

export const PTL_CELLULAR_DEFAULTS = RUNTIME_CELLULAR_CONFIG;
