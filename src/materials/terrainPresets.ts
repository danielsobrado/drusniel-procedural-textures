import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const TERRAIN_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'forest-loam',
    name: 'Forest Loam',
    description: 'Dark organic soil with compact clods, humus variation, leaf fragments and damp pockets.',
    tags: ['terrain', 'soil', 'ground', 'organic'],
    physical: {
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.03,
      clearcoatRoughness: 0.58,
      specularIntensity: 0.28,
      ior: 1.42,
      sheen: 0.04,
      sheenRoughness: 0.86,
      sheenColor: '#5d4d36',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-forest-loam-base', 'Deep soil', 'base', {
        colorA: '#17120d', colorB: '#33271b', roughness: 0.18
      }),
      layer('preset-forest-loam-humus', 'Humus variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.62, scale: 2.8, strength: 1.34, seed: 12,
        colorA: '#21170f', colorB: '#57422c', roughness: 0.06, displacement: 0.022
      }),
      layer('preset-forest-loam-clods', 'Soil clods', 'cellular', {
        blendMode: 'overlay', opacity: 0.58, scale: 6.4, strength: 1.2, seed: 29,
        colorA: '#1d1712', colorB: '#66513a', roughness: 0.08, displacement: 0.058
      }),
      layer('preset-forest-loam-litter', 'Leaf litter', 'spots', {
        blendMode: 'screen', opacity: 0.32, scale: 9.6, strength: 1.58, seed: 48,
        colorA: '#4a2f19', colorB: '#a07845', roughness: 0.02, displacement: 0.007
      }),
      layer('preset-forest-loam-damp', 'Damp pockets', 'wet-film', {
        channel: 'clearcoat', opacity: 0.18, scale: 5.2, strength: 1.22, seed: 67,
        colorA: '#34271e', colorB: '#776653', roughness: 0.24
      })
    ]
  },
  {
    id: 'red-clay-ground',
    name: 'Red Clay Ground',
    description: 'Compacted iron-rich clay with broad moisture stains, shallow erosion and embedded grit.',
    tags: ['terrain', 'soil', 'clay', 'ground'],
    physical: {
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.52,
      specularIntensity: 0.34,
      ior: 1.46,
      sheen: 0,
      sheenRoughness: 0.8,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-red-clay-base', 'Compacted clay', 'base', {
        colorA: '#572817', colorB: '#8a4a2b', roughness: 0.16
      }),
      layer('preset-red-clay-moisture', 'Moisture stains', 'fbm', {
        blendMode: 'multiply', opacity: 0.42, scale: 2.7, strength: 1.32, seed: 16,
        colorA: '#432116', colorB: '#985b36', roughness: 0.04, displacement: 0.012
      }),
      layer('preset-red-clay-erosion', 'Erosion channels', 'ridges', {
        blendMode: 'multiply', opacity: 0.36, scale: 6.8, strength: 1.36, seed: 34,
        colorA: '#472318', colorB: '#854628', roughness: 0.04, displacement: -0.016
      }),
      layer('preset-red-clay-grit', 'Embedded grit', 'spots', {
        blendMode: 'screen', opacity: 0.27, scale: 15.2, strength: 1.56, seed: 52,
        colorA: '#70402a', colorB: '#ba8257', roughness: 0.06, displacement: 0.004
      }),
      layer('preset-red-clay-sheen', 'Damp clay sheen', 'wet-film', {
        channel: 'clearcoat', opacity: 0.12, scale: 5.8, strength: 1.1, seed: 76,
        colorA: '#6f3825', colorB: '#aa6e52', roughness: 0.28
      }),
      layer('preset-red-clay-breakup', 'Fine clay breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.09, scale: 18.8, strength: 1.22, seed: 95,
        colorA: '#62321f', colorB: '#925139', roughness: 0.02, displacement: 0.001
      })
    ]
  },
  {
    id: 'alpine-scree',
    name: 'Alpine Scree',
    description: 'Cold fractured mountain ground with angular stone breakup, mineral bands and fine pale grit.',
    tags: ['terrain', 'rock', 'ground', 'mountain'],
    physical: {
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.62,
      specularIntensity: 0.38,
      ior: 1.5,
      sheen: 0,
      sheenRoughness: 0.78,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-alpine-scree-base', 'Cold stone', 'base', {
        colorA: '#31353a', colorB: '#585e62', roughness: 0.16
      }),
      layer('preset-alpine-scree-breakup', 'Fractured rocks', 'cellular', {
        blendMode: 'overlay', opacity: 0.7, scale: 5.2, strength: 1.28, seed: 19,
        colorA: '#25292d', colorB: '#767b7c', roughness: 0.1, displacement: 0.082
      }),
      layer('preset-alpine-scree-weathering', 'Weathering', 'fbm', {
        blendMode: 'multiply', opacity: 0.38, scale: 3.4, strength: 1.3, seed: 38,
        colorA: '#2a2c2d', colorB: '#6b665e', roughness: 0.04, displacement: 0.012
      }),
      layer('preset-alpine-scree-mineral', 'Mineral seams', 'veins', {
        blendMode: 'screen', opacity: 0.24, scale: 5.6, strength: 1.4, seed: 57,
        colorA: '#666968', colorB: '#c1c0b7', roughness: -0.04, displacement: 0.002
      }),
      layer('preset-alpine-scree-grit', 'Fine grit', 'spots', {
        blendMode: 'screen', opacity: 0.28, scale: 15.2, strength: 1.68, seed: 81,
        colorA: '#696d6d', colorB: '#c6c8c1', roughness: 0.06, displacement: 0.005
      })
    ]
  },
  {
    id: 'coastal-sand',
    name: 'Coastal Sand',
    description: 'Warm beach sand with wind ripples, compact damp patches and scattered pale shell grit.',
    tags: ['terrain', 'sand', 'coastal', 'ground', 'beach'],
    physical: {
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.025,
      clearcoatRoughness: 0.58,
      specularIntensity: 0.3,
      ior: 1.44,
      sheen: 0,
      sheenRoughness: 0.84,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-coastal-sand-base', 'Warm sand', 'base', {
        colorA: '#8a7656', colorB: '#b39b72', roughness: 0.17
      }),
      layer('preset-coastal-sand-swells', 'Sand swells', 'fbm', {
        blendMode: 'overlay', opacity: 0.4, scale: 3.6, strength: 1.22, seed: 23,
        colorA: '#806d50', colorB: '#c0aa82', roughness: 0.04, displacement: 0.012
      }),
      layer('preset-coastal-sand-ripples', 'Wind ripples', 'ridges', {
        blendMode: 'overlay', opacity: 0.36, scale: 12.8, strength: 1.46, seed: 42,
        colorA: '#78674d', colorB: '#b8a179', roughness: 0.03, displacement: 0.014
      }),
      layer('preset-coastal-sand-shells', 'Shell grit', 'spots', {
        blendMode: 'screen', opacity: 0.22, scale: 17.2, strength: 1.5, seed: 61,
        colorA: '#aa9877', colorB: '#d8c9a7', roughness: 0.04, displacement: 0.003
      }),
      layer('preset-coastal-sand-damp', 'Damp patches', 'wet-film', {
        channel: 'clearcoat', opacity: 0.12, scale: 5.4, strength: 1.08, seed: 79,
        colorA: '#7a6a55', colorB: '#a8997e', roughness: 0.24
      }),
      layer('preset-coastal-sand-grain', 'Fine grain breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.09, scale: 19.6, strength: 1.2, seed: 92,
        colorA: '#8b7a5e', colorB: '#aa9774', roughness: 0.02, displacement: 0.001
      })
    ]
  },
  {
    id: 'volcanic-soil',
    name: 'Volcanic Soil',
    description: 'Dark basaltic earth with porous clasts, ash variation, mineral flecks and shallow cooling cracks.',
    tags: ['terrain', 'soil', 'volcanic', 'rock', 'ground'],
    physical: {
      roughness: 0.54,
      metalness: 0,
      clearcoat: 0.01,
      clearcoatRoughness: 0.68,
      specularIntensity: 0.3,
      ior: 1.48,
      sheen: 0,
      sheenRoughness: 0.88,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-volcanic-soil-base', 'Basaltic earth', 'base', {
        colorA: '#171719', colorB: '#303033', roughness: 0.18
      }),
      layer('preset-volcanic-soil-ash', 'Ash variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.46, scale: 3.2, strength: 1.28, seed: 26,
        colorA: '#1e1d1e', colorB: '#4e4944', roughness: 0.05, displacement: 0.012
      }),
      layer('preset-volcanic-soil-clasts', 'Porous clasts', 'cellular', {
        blendMode: 'overlay', opacity: 0.42, scale: 7.4, strength: 1.16, seed: 45,
        colorA: '#111113', colorB: '#575251', roughness: 0.08, displacement: 0.03
      }),
      layer('preset-volcanic-soil-cracks', 'Cooling cracks', 'veins', {
        blendMode: 'multiply', opacity: 0.22, scale: 8.2, strength: 1.36, seed: 63,
        colorA: '#0e0e10', colorB: '#353235', roughness: 0.04, displacement: -0.008
      }),
      layer('preset-volcanic-soil-mineral', 'Mineral flecks', 'spots', {
        blendMode: 'screen', opacity: 0.18, scale: 16.6, strength: 1.46, seed: 84,
        colorA: '#5f5650', colorB: '#8c7a66', roughness: -0.02, displacement: 0.002
      }),
      layer('preset-volcanic-soil-breakup', 'Fine porous breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.1, scale: 19.8, strength: 1.22, seed: 95,
        colorA: '#28272a', colorB: '#474347', roughness: 0.02, displacement: 0.001
      })
    ]
  }
];
