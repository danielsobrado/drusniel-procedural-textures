import {
  DEFAULT_PATTERN_SETTINGS,
  type PatternSettings
} from '../core/material/PatternSettings';
import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

function grassPattern(overrides: Partial<PatternSettings> = {}): PatternSettings {
  return {
    ...DEFAULT_PATTERN_SETTINGS,
    kind: 'grass',
    density: 1.8,
    jitter: 0.58,
    edgeWear: 0.12,
    bladeLength: 0.84,
    bladeWidth: 0.038,
    bladeTaper: 1.85,
    bladeBend: 0.11,
    bladeCurvature: 1.6,
    clumpScale: 0.6,
    clumpStrength: 0.66,
    directionality: 0.62,
    dryness: 0.05,
    tipFade: 0.12,
    rootDarkening: 0.68,
    heightJitter: 0.34,
    widthJitter: 0.28,
    leanJitter: 0.52,
    ...overrides
  };
}

function turfPattern(overrides: Partial<PatternSettings> = {}): PatternSettings {
  return {
    ...DEFAULT_PATTERN_SETTINGS,
    kind: 'turf',
    density: 2.25,
    jitter: 0.7,
    edgeWear: 0.16,
    clumpScale: 0.6,
    clumpStrength: 0.68,
    directionality: 0.58,
    dryness: 0.08,
    rootDarkening: 0.68,
    fiberLength: 0.38,
    fiberWidth: 0.05,
    fiberBreakup: 0.62,
    fiberSoftness: 0.7,
    ...overrides
  };
}

export const GRASS_EXTENSION_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'wetland-sedge',
    name: 'Wetland Sedge',
    description: 'Coarse wetland sedge with genuinely blade-like tall tufts, dark saturated roots and restrained wet highlights.',
    tags: ['grass', 'vegetation', 'wetland', 'wet', 'terrain'],
    physical: {
      roughness: 0.62, metalness: 0, clearcoat: 0.035, clearcoatRoughness: 0.5,
      specularIntensity: 0.29, ior: 1.37, sheen: 0.14, sheenRoughness: 0.82,
      sheenColor: '#60784c', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { variation: 0.44, stochasticTiling: 0.14 },
    layers: [
      layer('preset-wetland-sedge-base', 'Saturated ground', 'fbm', {
        colorA: '#141a13', colorB: '#303a29', roughness: 0.16,
        scale: 4.2, strength: 1.04, seed: 17, displacement: 0.003
      }),
      layer('preset-wetland-sedge-blades', 'Tall sedge tufts', 'pattern', {
        blendMode: 'overlay', opacity: 0.76, scale: 9.6, strength: 1.2, seed: 35,
        colorA: '#244127', colorB: '#718753', roughness: 0, displacement: 0.005,
        pattern: grassPattern({
          density: 1.45, bladeLength: 0.93, bladeWidth: 0.03, bladeTaper: 2,
          bladeBend: 0.12, clumpScale: 0.48, clumpStrength: 0.78,
          directionality: 0.72, heightJitter: 0.25, widthJitter: 0.22, leanJitter: 0.45
        })
      }),
      layer('preset-wetland-sedge-understory', 'Wet turf understory', 'pattern', {
        channel: 'color', blendMode: 'overlay', opacity: 0.26, scale: 11.4, strength: 1.04, seed: 58,
        colorA: '#203621', colorB: '#586f45',
        pattern: turfPattern({
          density: 2.15, clumpStrength: 0.7, directionality: 0.54,
          fiberLength: 0.34, fiberBreakup: 0.66, fiberSoftness: 0.76
        })
      }),
      layer('preset-wetland-sedge-pale', 'Pale sedge tips', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.075, scale: 10.2, strength: 1.03, seed: 72,
        colorA: '#5d7850', colorB: '#a9bc7c',
        pattern: grassPattern({
          density: 0.95, bladeLength: 0.95, bladeWidth: 0.023, bladeBend: 0.14,
          clumpStrength: 0.45, directionality: 0.62, dryness: 0.35,
          rootDarkening: 0.38, heightJitter: 0.32, leanJitter: 0.58
        })
      }),
      layer('preset-wetland-sedge-water', 'Root wetness', 'wet-film', {
        channel: 'clearcoat', opacity: 0.08, scale: 8.8, strength: 1.03, seed: 91,
        colorA: '#344737', colorB: '#748779', roughness: 0.2
      })
    ]
  },
  {
    id: 'frosted-grass',
    name: 'Frosted Grass',
    description: 'Cold matted turf with muted green fibers, fragmented frost coverage and a few pale frozen blade accents.',
    tags: ['grass', 'vegetation', 'cold', 'frost', 'terrain'],
    physical: {
      roughness: 0.69, metalness: 0, clearcoat: 0.018, clearcoatRoughness: 0.62,
      specularIntensity: 0.27, ior: 1.38, sheen: 0.14, sheenRoughness: 0.82,
      sheenColor: '#aab8a6', transmission: 0, thickness: 0,
      attenuationDistance: 2, attenuationColor: '#ffffff'
    },
    synthesis: { variation: 0.4, stochasticTiling: 0.15 },
    layers: [
      layer('preset-frosted-grass-base', 'Cold grass bed', 'fbm', {
        colorA: '#252c24', colorB: '#465142', roughness: 0.19,
        scale: 4, strength: 1.04, seed: 20, displacement: 0.002
      }),
      layer('preset-frosted-grass-turf', 'Frozen turf fibers', 'pattern', {
        blendMode: 'overlay', opacity: 0.8, scale: 11, strength: 1.14, seed: 39,
        colorA: '#354b36', colorB: '#7f9076', roughness: 0.02, displacement: 0.003,
        pattern: turfPattern({
          density: 2.35, clumpStrength: 0.68, directionality: 0.6,
          fiberLength: 0.36, fiberBreakup: 0.68, fiberSoftness: 0.72
        })
      }),
      layer('preset-frosted-grass-crystals', 'Frosted blade accents', 'pattern', {
        channel: 'color', blendMode: 'screen', opacity: 0.065, scale: 11.8, strength: 1.03, seed: 57,
        colorA: '#87968b', colorB: '#d2dbd0', roughness: -0.02,
        pattern: grassPattern({
          density: 0.95, bladeLength: 0.82, bladeWidth: 0.022, bladeBend: 0.09,
          clumpStrength: 0.4, directionality: 0.54, dryness: 0.28,
          tipFade: 0.02, rootDarkening: 0.34, heightJitter: 0.36, leanJitter: 0.58
        })
      })
    ]
  }
];
