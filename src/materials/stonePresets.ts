import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

const CUT_COBBLE_STRUCTURE_ID = 'preset-stone-cut-cobble-structure';
const FLAGSTONE_STRUCTURE_ID = 'preset-stone-weathered-flagstone-structure';

export const STONE_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'cut-cobble-stone',
    name: 'Cut Cobble Stone',
    description: 'Blue-grey cut stone blocks with recessed mortar joints, chipped edges and dry weathered variation.',
    tags: ['stone', 'mineral', 'masonry', 'cobble', 'pavement'],
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
      layer('preset-stone-cut-cobble-tone', 'Stone tone breakup', 'fbm', {
        blendMode: 'overlay',
        opacity: 0.34,
        scale: 2.3,
        strength: 1.22,
        seed: 31,
        colorA: '#42484b',
        colorB: '#9ea4a8',
        roughness: 0.03,
        displacement: 0.008
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
      layer('preset-stone-cut-cobble-roughness', 'Dry stone roughness', 'fbm', {
        channel: 'roughness',
        opacity: 0.34,
        scale: 11.6,
        strength: 1.18,
        seed: 73,
        roughness: 0.18
      })
    ]
  },
  {
    id: 'weathered-flagstone',
    name: 'Weathered Flagstone',
    description: 'Warm tan irregular flagstone with fractured rock plates, dusty seams and layered erosion.',
    tags: ['stone', 'mineral', 'rock', 'flagstone', 'weathered'],
    physical: {
      roughness: 0.66,
      metalness: 0,
      clearcoat: 0.01,
      clearcoatRoughness: 0.9,
      specularIntensity: 0.38,
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
      age: 0.46,
      weathering: 0.58,
      gravity: -0.16,
      macro: 1.04,
      meso: 1.14,
      micro: 0.88,
      variation: 0.36,
      stochasticTiling: 0.08
    },
    layers: [
      layer('preset-stone-weathered-flagstone-base', 'Dusty stone base', 'base', {
        colorA: '#6f5f49',
        colorB: '#b59f7f',
        roughness: 0.09
      }),
      layer(FLAGSTONE_STRUCTURE_ID, 'Broken stone plates', 'cellular', {
        blendMode: 'overlay',
        opacity: 0.88,
        scale: 4.2,
        strength: 1.68,
        seed: 22,
        colorA: '#6a593f',
        colorB: '#c1aa87',
        roughness: 0.05,
        displacement: 0.114
      }),
      layer('preset-stone-weathered-flagstone-tone', 'Plate color variation', 'cellular', {
        blendMode: 'overlay',
        channel: 'color',
        opacity: 0.32,
        scale: 4.2,
        strength: 1.42,
        seed: 22,
        colorA: '#5f513b',
        colorB: '#cfbc9b',
        structureSourceLayerId: FLAGSTONE_STRUCTURE_ID
      }),
      layer('preset-stone-weathered-flagstone-seams', 'Dusty seams', 'cellular', {
        blendMode: 'screen',
        channel: 'color',
        opacity: 0.74,
        scale: 4.2,
        strength: 1.74,
        seed: 22,
        colorA: '#7f6d54',
        colorB: '#ddd1b8',
        structureSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-weathered-flagstone-depth', 'Fracture depth', 'cellular', {
        channel: 'height',
        opacity: 0.9,
        scale: 4.2,
        strength: 1.82,
        seed: 22,
        displacement: 0.072,
        structureSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskSourceLayerId: FLAGSTONE_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-stone-weathered-flagstone-erosion', 'Weathered erosion', 'erosion', {
        blendMode: 'overlay',
        opacity: 0.32,
        scale: 3.1,
        strength: 1.28,
        seed: 41,
        colorA: '#5c4d37',
        colorB: '#bca789',
        roughness: 0.06,
        displacement: 0.012
      }),
      layer('preset-stone-weathered-flagstone-stains', 'Mineral stains', 'spots', {
        blendMode: 'multiply',
        opacity: 0.16,
        scale: 12.8,
        strength: 1.22,
        seed: 56,
        colorA: '#8b6938',
        colorB: '#c6a36e',
        roughness: 0.04,
        displacement: -0.004
      }),
      layer('preset-stone-weathered-flagstone-ridges', 'Layered rock ridges', 'ridges', {
        blendMode: 'screen',
        opacity: 0.18,
        scale: 8.6,
        strength: 1.24,
        seed: 68,
        colorA: '#7a664b',
        colorB: '#d4c3a2',
        roughness: 0.01,
        displacement: 0.01
      }),
      layer('preset-stone-weathered-flagstone-roughness', 'Dry rock roughness', 'fbm', {
        channel: 'roughness',
        opacity: 0.38,
        scale: 13.7,
        strength: 1.16,
        seed: 79,
        roughness: 0.22
      })
    ]
  }
];
