import {
  DEFAULT_PATTERN_SETTINGS,
  type PatternSettings
} from '../core/material/PatternSettings';
import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

function turfPattern(overrides: Partial<PatternSettings> = {}): PatternSettings {
  return {
    ...DEFAULT_PATTERN_SETTINGS,
    kind: 'turf',
    density: 2.35,
    jitter: 0.72,
    edgeWear: 0.16,
    clumpScale: 0.64,
    clumpStrength: 0.7,
    directionality: 0.62,
    dryness: 0.05,
    rootDarkening: 0.68,
    fiberLength: 0.38,
    fiberWidth: 0.052,
    fiberBreakup: 0.58,
    fiberSoftness: 0.72,
    ...overrides
  };
}

function bladePattern(overrides: Partial<PatternSettings> = {}): PatternSettings {
  return {
    ...DEFAULT_PATTERN_SETTINGS,
    kind: 'grass',
    density: 1.3,
    jitter: 0.64,
    edgeWear: 0.1,
    bladeLength: 0.84,
    bladeWidth: 0.025,
    bladeTaper: 2,
    bladeBend: 0.11,
    bladeCurvature: 1.6,
    clumpScale: 0.58,
    clumpStrength: 0.44,
    directionality: 0.58,
    dryness: 0.12,
    tipFade: 0.1,
    rootDarkening: 0.52,
    heightJitter: 0.38,
    widthJitter: 0.32,
    leanJitter: 0.62,
    ...overrides
  };
}

export const GRASS_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'lush-turf',
    name: 'Lush Turf',
    description: 'Dense fresh lawn-like turf built from soft short fibers, shaded root mass and very sparse young blades.',
    tags: ['grass', 'vegetation', 'terrain', 'ground'],
    physical: {
      roughness: 0.69, metalness: 0, clearcoat: 0.008, clearcoatRoughness: 0.67,
      specularIntensity: 0.24, ior: 1.38, sheen: 0.12, sheenRoughness: 0.84,
      sheenColor: '#66804d', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { variation: 0.4, stochasticTiling: 0.16 },
    layers: [
      layer('preset-lush-turf-base', 'Soil & thatch', 'fbm', {
        colorA: '#131810', colorB: '#323821', roughness: 0.2,
        scale: 4.4, strength: 1.04, seed: 8, displacement: 0.003
      }),
      layer('preset-lush-turf-fibers', 'Main turf fibers', 'pattern', {
        blendMode: 'overlay', opacity: 0.88, scale: 11.8, strength: 1.18, seed: 29,
        colorA: '#19331a', colorB: '#71964a', roughness: 0.01, displacement: 0.004,
        pattern: turfPattern({ density: 2.6, clumpStrength: 0.76, directionality: 0.7 })
      }),
      layer('preset-lush-turf-variation', 'Turf color variation', 'pattern', {
        channel: 'color', blendMode: 'overlay', opacity: 0.28, scale: 11.8, strength: 1.04, seed: 29,
        colorA: '#213a20', colorB: '#8dac58',
        structureSourceLayerId: 'preset-lush-turf-fibers',
        pattern: turfPattern({ density: 2.6, clumpStrength: 0.76, directionality: 0.7 })
      }),
      layer('preset-lush-turf-accent', 'Sparse young blades', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.05, scale: 12.6, strength: 1.05, seed: 61,
        colorA: '#4a7138', colorB: '#9ec567',
        pattern: bladePattern({ density: 1.15, bladeLength: 0.78, clumpStrength: 0.38 })
      })
    ]
  },
  {
    id: 'wild-meadow-grass',
    name: 'Wild Meadow Grass',
    description: 'Mixed meadow cover with irregular turf mass, a few taller green blades and fragmented dry thatch.',
    tags: ['grass', 'vegetation', 'meadow', 'terrain'],
    physical: {
      roughness: 0.71, metalness: 0, clearcoat: 0.006, clearcoatRoughness: 0.68,
      specularIntensity: 0.23, ior: 1.38, sheen: 0.11, sheenRoughness: 0.85,
      sheenColor: '#747f4d', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { variation: 0.5, stochasticTiling: 0.18 },
    layers: [
      layer('preset-meadow-grass-base', 'Meadow soil & thatch', 'fbm', {
        colorA: '#222619', colorB: '#484b2b', roughness: 0.21,
        scale: 3.8, strength: 1.06, seed: 17, displacement: 0.003
      }),
      layer('preset-meadow-grass-turf', 'Meadow turf mass', 'pattern', {
        blendMode: 'overlay', opacity: 0.82, scale: 10.8, strength: 1.16, seed: 37,
        colorA: '#253d20', colorB: '#748b49', roughness: 0.015, displacement: 0.004,
        pattern: turfPattern({
          density: 2.2, clumpScale: 0.54, clumpStrength: 0.66, directionality: 0.5,
          fiberLength: 0.4, fiberBreakup: 0.64, fiberSoftness: 0.67
        })
      }),
      layer('preset-meadow-grass-fresh', 'Sparse meadow blades', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.075, scale: 11.7, strength: 1.05, seed: 58,
        colorA: '#456437', colorB: '#98aa61',
        pattern: bladePattern({
          density: 1.1, bladeLength: 0.9, bladeWidth: 0.023,
          clumpStrength: 0.4, directionality: 0.44, heightJitter: 0.44, leanJitter: 0.72
        })
      }),
      layer('preset-meadow-grass-thatch', 'Dry thatch', 'pattern', {
        channel: 'color', blendMode: 'overlay', opacity: 0.18, scale: 12.4, strength: 1.03, seed: 79,
        colorA: '#675d3a', colorB: '#aa955f',
        pattern: turfPattern({
          density: 2.05, clumpStrength: 0.48, directionality: 0.42, dryness: 0.64,
          rootDarkening: 0.38, fiberLength: 0.33, fiberWidth: 0.038,
          fiberBreakup: 0.84, fiberSoftness: 0.6
        })
      })
    ]
  },
  {
    id: 'dry-savanna-grass',
    name: 'Dry Savanna Grass',
    description: 'Sun-dried grassland dominated by broken straw fiber mats with dusty olive undergrowth and sparse green recovery.',
    tags: ['grass', 'vegetation', 'dry', 'terrain'],
    physical: {
      roughness: 0.76, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.74,
      specularIntensity: 0.21, ior: 1.36, sheen: 0.07, sheenRoughness: 0.9,
      sheenColor: '#968655', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { age: 0.2, weathering: 0.2, variation: 0.52, stochasticTiling: 0.2 },
    layers: [
      layer('preset-savanna-grass-base', 'Dusty undergrowth', 'fbm', {
        colorA: '#38341f', colorB: '#605735', roughness: 0.23,
        scale: 4, strength: 1.04, seed: 15, displacement: 0.002
      }),
      layer('preset-savanna-grass-mat', 'Dry turf mat', 'pattern', {
        blendMode: 'overlay', opacity: 0.84, scale: 10.2, strength: 1.14, seed: 35,
        colorA: '#5e532f', colorB: '#ad965b', roughness: 0.05, displacement: 0.003,
        pattern: turfPattern({
          density: 2.25, clumpScale: 0.5, clumpStrength: 0.6, directionality: 0.46,
          dryness: 0.58, rootDarkening: 0.4, fiberLength: 0.37, fiberWidth: 0.04,
          fiberBreakup: 0.82, fiberSoftness: 0.58
        })
      }),
      layer('preset-savanna-grass-green', 'Surviving green tufts', 'pattern', {
        channel: 'color', blendMode: 'overlay', opacity: 0.13, scale: 10.8, strength: 1.03, seed: 56,
        colorA: '#374628', colorB: '#78834a',
        pattern: turfPattern({
          density: 1.8, clumpStrength: 0.7, dryness: 0.24,
          fiberLength: 0.34, fiberBreakup: 0.55, fiberSoftness: 0.66
        })
      }),
      layer('preset-savanna-grass-straw', 'Pale straw fibers', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.11, scale: 12.2, strength: 1.02, seed: 77,
        colorA: '#887746', colorB: '#bfa768',
        pattern: turfPattern({
          density: 2.1, clumpStrength: 0.4, directionality: 0.38, dryness: 0.76,
          rootDarkening: 0.28, fiberLength: 0.31, fiberWidth: 0.034,
          fiberBreakup: 0.9, fiberSoftness: 0.52
        })
      })
    ]
  },
  {
    id: 'coastal-dune-grass',
    name: 'Coastal Dune Grass',
    description: 'Wind-combed dune turf with sandy gaps, aligned fiber mats, bleached thatch and a few taller accents.',
    tags: ['grass', 'vegetation', 'coastal', 'sand', 'terrain'],
    physical: {
      roughness: 0.72, metalness: 0, clearcoat: 0.004, clearcoatRoughness: 0.72,
      specularIntensity: 0.22, ior: 1.36, sheen: 0.08, sheenRoughness: 0.88,
      sheenColor: '#89905c', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { variation: 0.44, stochasticTiling: 0.17 },
    layers: [
      layer('preset-dune-grass-base', 'Sandy grass bed', 'fbm', {
        colorA: '#4e4931', colorB: '#746d48', roughness: 0.21,
        scale: 3.6, strength: 1.03, seed: 22, displacement: 0.002
      }),
      layer('preset-dune-grass-turf', 'Wind-combed turf', 'pattern', {
        blendMode: 'overlay', opacity: 0.74, scale: 10, strength: 1.14, seed: 44,
        colorA: '#465332', colorB: '#849158', roughness: 0.025, displacement: 0.003,
        pattern: turfPattern({
          density: 2.1, clumpScale: 0.48, clumpStrength: 0.56, directionality: 0.9,
          dryness: 0.16, fiberLength: 0.42, fiberWidth: 0.043,
          fiberBreakup: 0.66, fiberSoftness: 0.62
        })
      }),
      layer('preset-dune-grass-bleached', 'Bleached thatch', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.13, scale: 11.2, strength: 1.02, seed: 83,
        colorA: '#80774d', colorB: '#b9aa75',
        pattern: turfPattern({
          density: 1.9, clumpStrength: 0.42, directionality: 0.84, dryness: 0.68,
          rootDarkening: 0.32, fiberLength: 0.35, fiberWidth: 0.035,
          fiberBreakup: 0.86, fiberSoftness: 0.56
        })
      }),
      layer('preset-dune-grass-accent', 'Sparse dune blades', 'pattern', {
        channel: 'color', blendMode: 'overlay', opacity: 0.055, scale: 10.8, strength: 1.04, seed: 93,
        colorA: '#56623d', colorB: '#919b61',
        pattern: bladePattern({
          density: 0.95, bladeLength: 0.92, bladeWidth: 0.022,
          bladeBend: 0.17, directionality: 0.9, clumpStrength: 0.36, leanJitter: 0.5
        })
      })
    ]
  },
  {
    id: 'forest-understory-grass',
    name: 'Forest Understory Grass',
    description: 'Shade-grown understory with damp dark turf fibers, matted root structure and restrained pale new growth.',
    tags: ['grass', 'vegetation', 'forest', 'damp', 'terrain'],
    physical: {
      roughness: 0.68, metalness: 0, clearcoat: 0.018, clearcoatRoughness: 0.58,
      specularIntensity: 0.25, ior: 1.38, sheen: 0.12, sheenRoughness: 0.83,
      sheenColor: '#657950', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { variation: 0.48, stochasticTiling: 0.17 },
    layers: [
      layer('preset-understory-grass-base', 'Damp soil & thatch', 'fbm', {
        colorA: '#141a13', colorB: '#31372a', roughness: 0.19,
        scale: 4.3, strength: 1.05, seed: 25, displacement: 0.002
      }),
      layer('preset-understory-grass-turf', 'Shade turf mass', 'pattern', {
        blendMode: 'overlay', opacity: 0.8, scale: 10.8, strength: 1.15, seed: 47,
        colorA: '#1b3320', colorB: '#647948', roughness: 0.005, displacement: 0.003,
        pattern: turfPattern({
          density: 2.2, clumpScale: 0.54, clumpStrength: 0.72, directionality: 0.46,
          rootDarkening: 0.78, fiberLength: 0.36, fiberBreakup: 0.62, fiberSoftness: 0.76
        })
      }),
      layer('preset-understory-grass-new', 'Pale new growth', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.06, scale: 11.8, strength: 1.03, seed: 85,
        colorA: '#517047', colorB: '#99b174',
        pattern: bladePattern({
          density: 1, bladeLength: 0.82, bladeWidth: 0.022,
          clumpStrength: 0.4, directionality: 0.4, heightJitter: 0.42, leanJitter: 0.7
        })
      }),
      layer('preset-understory-grass-damp', 'Damp root sheen', 'wet-film', {
        channel: 'clearcoat', opacity: 0.06, scale: 9.2, strength: 1.03, seed: 98,
        colorA: '#394938', colorB: '#6e7e6d', roughness: 0.24
      })
    ]
  }
];
