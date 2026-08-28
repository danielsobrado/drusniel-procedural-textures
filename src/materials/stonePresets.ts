import {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  type TextureFieldSettings
} from '../core/texture/TextureFieldSettings';
import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

const CUT_COBBLE_STRUCTURE_ID = 'preset-stone-cut-cobble-structure';
const FLAGSTONE_STRUCTURE_ID = 'preset-stone-weathered-flagstone-structure';

const STONE_TEXTURE_FIELDS = {
  cobbleMeso: 'stone.02',
  cobbleCracks: 'cracks.04',
  cobbleRoughness: 'super-noise.04',
  flagstoneMineral: 'stone.03',
  flagstoneGrain: 'grainy.05',
  flagstoneRoughness: 'super-noise.05'
} as const;

function textureField(
  id: string,
  overrides: Partial<TextureFieldSettings> = {}
): TextureFieldSettings {
  return {
    ...DEFAULT_TEXTURE_FIELD_SETTINGS,
    mode: 'modulate',
    id,
    ...overrides
  };
}

export const STONE_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'cut-cobble-stone',
    name: 'Cut Cobble Stone',
    description: 'Blue-grey cut stone blocks with recessed mortar joints, chipped edges and hybrid mineral surface variation.',
    tags: ['stone', 'mineral', 'masonry', 'cobble', 'pavement', 'hybrid'],
    physical: {
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.82,
      specularIntensity: 0.42,
      ior: 1.48,
      sheen: 0,
      sheenRoughness: 0.7,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    synthesis: {
      age: 0.28,
      weathering: 0.34,
      gravity: -0.08,
      macro: 0.92,
      meso: 1.08,
      micro: 0.78,
      variation: 0.2,
      stochasticTiling: 0.04
    },
    layers: [
      layer('preset-stone-cut-cobble-base', 'Stone base', 'base', {
        colorA: '#54575a',
        colorB: '#8a8f93',
        roughness: 0.08
      }),
      layer(CUT_COBBLE_STRUCTURE_ID, 'Block structure', 'sdf', {
        blendMode: 'overlay',
        opacity: 0.92,
        scale: 5.1,
        strength: 1.74,
        seed: 18,
        colorA: '#4d5255',
        colorB: '#94999d',
        roughness: 0.04,
        displacement: 0.088
      }),
      layer('preset-stone-cut-cobble-tone', 'Hybrid stone breakup', 'fbm', {
        blendMode: 'overlay',
        opacity: 0.3,
        scale: 2.45,
        strength: 1.08,
        seed: 31,
        colorA: '#42484b',
        colorB: '#9ea4a8',
        roughness: 0.025,
        displacement: 0.012,
        texture: textureField(STONE_TEXTURE_FIELDS.cobbleMeso, {
          scaleX: 1.14,
          scaleY: 0.87,
          rotation: 0.31,
          offsetX: 0.17,
          offsetY: 0.43,
          contrast: 1.18,
          bias: -0.02
        })
      }),
      layer('preset-stone-cut-cobble-joints', 'Mortar joints', 'sdf', {
        blendMode: 'screen',
        channel: 'color',
        opacity: 0.78,
        scale: 5.1,
        strength: 1.86,
        seed: 18,
        colorA: '#69665f',
        colorB: '#b2aca0',
        structureSourceLayerId: CUT_COBBLE_STRUCTURE_ID,
        maskSourceLayerId: CUT_COBBLE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-cut-cobble-joint-depth', 'Joint recess', 'sdf', {
        channel: 'height',
        opacity: 0.92,
        scale: 5.1,
        strength: 1.9,
        seed: 18,
        displacement: 0.064,
        structureSourceLayerId: CUT_COBBLE_STRUCTURE_ID,
        maskSourceLayerId: CUT_COBBLE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-cut-cobble-edge-wear', 'Edge wear', 'ridges', {
        blendMode: 'screen',
        opacity: 0.18,
        scale: 9.4,
        strength: 1.36,
        seed: 47,
        colorA: '#666b70',
        colorB: '#b3b7ba',
        roughness: -0.02,
        displacement: 0.006
      }),
      layer('preset-stone-cut-cobble-chips', 'Surface chips', 'spots', {
        blendMode: 'multiply',
        opacity: 0.16,
        scale: 14.8,
        strength: 1.34,
        seed: 59,
        colorA: '#34383b',
        colorB: '#73797d',
        roughness: 0.04,
        displacement: -0.01
      }),
      layer('preset-stone-cut-cobble-cracks', 'Stone crack breakup', 'veins', {
        channel: 'height',
        opacity: 0.11,
        scale: 7.4,
        strength: 1.34,
        seed: 67,
        displacement: -0.009,
        maskSourceLayerId: CUT_COBBLE_STRUCTURE_ID,
        maskStrength: 0.9,
        texture: textureField(STONE_TEXTURE_FIELDS.cobbleCracks, {
          scaleX: 0.96,
          scaleY: 1.23,
          rotation: 0.69,
          offsetX: 0.38,
          offsetY: 0.11,
          contrast: 1.42,
          bias: -0.06
        })
      }),
      layer('preset-stone-cut-cobble-roughness', 'Hybrid dry stone roughness', 'fbm', {
        channel: 'roughness',
        opacity: 0.3,
        scale: 11.8,
        strength: 1.05,
        seed: 73,
        roughness: 0.16,
        texture: textureField(STONE_TEXTURE_FIELDS.cobbleRoughness, {
          mode: 'detail', modeAmount: 0.35,
          scaleX: 1.37,
          scaleY: 0.91,
          rotation: -0.48,
          offsetX: 0.29,
          offsetY: 0.57,
          contrast: 0.92,
          bias: 0.03
        })
      })
    ]
  },
  {
    id: 'weathered-flagstone',
    name: 'Weathered Flagstone',
    description: 'Weathered warm sandstone with irregular fractured plates, hybrid mineral breakup, dark cavities and granular erosion.',
    tags: ['stone', 'mineral', 'rock', 'flagstone', 'weathered', 'sandstone', 'hybrid'],
    physical: {
      roughness: 0.72,
      metalness: 0,
      clearcoat: 0,
      clearcoatRoughness: 1,
      specularIntensity: 0.32,
      ior: 1.5,
      sheen: 0,
      sheenRoughness: 0.8,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    synthesis: {
      age: 0.52,
      weathering: 0.62,
      gravity: -0.14,
      macro: 0.98,
      meso: 1.08,
      micro: 1.34,
      variation: 0.42,
      stochasticTiling: 0.12
    },
    layers: [
      layer('preset-stone-weathered-flagstone-base', 'Sandstone base', 'base', {
        colorA: '#654735',
        colorB: '#b98261',
        roughness: 0.06
      }),
      layer(FLAGSTONE_STRUCTURE_ID, 'Broken stone plates', 'cellular', {
        channel: 'height',
        opacity: 0.94,
        scale: 4.05,
        strength: 1.55,
        seed: 22,
        displacement: 0.104
      }),
      layer('preset-stone-weathered-flagstone-tone', 'Hybrid mineral clouding', 'fbm', {
        blendMode: 'overlay',
        channel: 'color',
        opacity: 0.25,
        scale: 1.9,
        strength: 1.1,
        seed: 34,
        colorA: '#664430',
        colorB: '#c49370',
        texture: textureField(STONE_TEXTURE_FIELDS.flagstoneMineral, {
          scaleX: 1.18,
          scaleY: 0.82,
          rotation: -0.27,
          offsetX: 0.41,
          offsetY: 0.19,
          contrast: 1.12,
          bias: -0.01
        })
      }),
      layer('preset-stone-weathered-flagstone-seams', 'Recessed fracture color', 'cellular', {
        blendMode: 'multiply',
        channel: 'color',
        opacity: 0.7,
        scale: 4.05,
        strength: 1.72,
        seed: 22,
        colorA: '#493027',
        colorB: '#76503d',
        structureSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-weathered-flagstone-depth', 'Primary fracture depth', 'cellular', {
        channel: 'height',
        opacity: 0.9,
        scale: 4.05,
        strength: 1.78,
        seed: 22,
        displacement: 0.064,
        structureSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-weathered-flagstone-erosion', 'Weathered erosion', 'erosion', {
        blendMode: 'overlay',
        opacity: 0.24,
        scale: 3.35,
        strength: 1.22,
        seed: 41,
        colorA: '#5f4332',
        colorB: '#ad8061',
        roughness: 0.04,
        displacement: 0.01
      }),
      layer('preset-stone-weathered-flagstone-stains', 'Iron mineral stains', 'spots', {
        blendMode: 'multiply',
        channel: 'color',
        opacity: 0.13,
        scale: 12.4,
        strength: 1.2,
        seed: 56,
        colorA: '#70452e',
        colorB: '#9f6a45'
      }),
      layer('preset-stone-weathered-flagstone-secondary-fractures', 'Secondary fractures', 'veins', {
        blendMode: 'multiply',
        opacity: 0.2,
        scale: 6.8,
        strength: 1.42,
        seed: 87,
        colorA: '#3f2a23',
        colorB: '#76513f',
        roughness: 0.07,
        displacement: -0.012
      }),
      layer('preset-stone-weathered-flagstone-grain', 'Hybrid sandstone grain', 'spots', {
        blendMode: 'multiply',
        opacity: 0.12,
        scale: 18.2,
        strength: 1.12,
        seed: 94,
        colorA: '#604231',
        colorB: '#b88464',
        roughness: 0.065,
        displacement: -0.004,
        texture: textureField(STONE_TEXTURE_FIELDS.flagstoneGrain, {
          scaleX: 1.42,
          scaleY: 0.88,
          rotation: 0.52,
          offsetX: 0.13,
          offsetY: 0.61,
          contrast: 1.08,
          bias: -0.025
        })
      }),
      layer('preset-stone-weathered-flagstone-cavity-ao', 'Fracture cavity occlusion', 'cellular', {
        channel: 'ao',
        opacity: 0.82,
        scale: 4.05,
        strength: 1.78,
        seed: 22,
        structureSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-weathered-flagstone-roughness', 'Hybrid dry granular roughness', 'fbm', {
        channel: 'roughness',
        opacity: 0.3,
        scale: 16.8,
        strength: 1.08,
        seed: 79,
        roughness: 0.15,
        texture: textureField(STONE_TEXTURE_FIELDS.flagstoneRoughness, {
          mode: 'detail', modeAmount: 0.35,
          scaleX: 1.29,
          scaleY: 0.93,
          rotation: -0.41,
          offsetX: 0.54,
          offsetY: 0.27,
          contrast: 0.96,
          bias: 0.02
        })
      })
    ]
  }
];
