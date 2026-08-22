import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const CORE_MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'adipose-v8',
    name: 'Adipose Tissue · SSS',
    description: 'Layered adipose tissue with branching vessels, subsurface depth and a procedural wet film.',
    tags: ['biological', 'organic', 'sss', 'wet'],
    physical: {
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.22,
      clearcoatRoughness: 0.1,
      specularIntensity: 0.76,
      ior: 1.38,
      sheen: 0.28,
      sheenRoughness: 0.58,
      sheenColor: '#f0a08d',
      transmission: 0.08,
      thickness: 0.42,
      attenuationDistance: 1.15,
      attenuationColor: '#f3a05d'
    },
    layers: [
      layer('preset-adipose-base', 'Deep fat', 'base', {
        colorA: '#d78b25',
        colorB: '#f2bf72',
        roughness: 0.16
      }),
      layer('preset-adipose-clouds', 'Cloudy fat', 'fbm', {
        blendMode: 'screen',
        opacity: 0.62,
        scale: 2.2,
        strength: 1.15,
        seed: 8,
        colorA: '#c87820',
        colorB: '#f6d49c',
        roughness: 0.1,
        displacement: 0.04
      }),
      layer('preset-adipose-lobules', 'Lobules', 'cellular', {
        blendMode: 'overlay',
        opacity: 0.48,
        scale: 4.5,
        strength: 1.05,
        seed: 17,
        colorA: '#d88f37',
        colorB: '#f4d9a9',
        roughness: 0.06,
        displacement: 0.03
      }),
      layer('preset-adipose-fascia', 'Fascia', 'ridges', {
        blendMode: 'screen',
        opacity: 0.3,
        scale: 7.5,
        strength: 1.3,
        seed: 31,
        colorA: '#d47c67',
        colorB: '#f5cab5',
        roughness: -0.06,
        displacement: 0.006
      }),
      layer('preset-adipose-vessels', 'Branching vessels', 'vessels', {
        blendMode: 'multiply',
        channel: 'color',
        opacity: 0.55,
        scale: 6.6,
        strength: 1.35,
        seed: 44,
        colorA: '#7f2831',
        colorB: '#c65e5d'
      }),
      layer('preset-adipose-sss', 'Subsurface depth', 'sss', {
        channel: 'sss',
        opacity: 0.66,
        scale: 2.6,
        strength: 1.2,
        seed: 52,
        colorA: '#f09b42',
        colorB: '#c83e45'
      }),
      layer('preset-adipose-wet', 'Wet membrane', 'wet-film', {
        channel: 'clearcoat',
        opacity: 0.78,
        scale: 5.2,
        strength: 1.1,
        seed: 61,
        colorA: '#d8a28f',
        colorB: '#fff0e2',
        roughness: -0.18
      })
    ]
  },
  {
    id: 'storm-marble',
    name: 'Storm Marble',
    description: 'Dark stone with layered mineral veins and soft depth.',
    tags: ['stone', 'marble', 'mineral', 'architectural'],
    physical: {
      roughness: 0.24,
      metalness: 0,
      clearcoat: 0.18,
      clearcoatRoughness: 0.2,
      specularIntensity: 0.68,
      ior: 1.5,
      sheen: 0,
      sheenRoughness: 0.7,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-marble-base', 'Stone', 'base', {
        colorA: '#181c21', colorB: '#353c44', roughness: 0.32
      }),
      layer('preset-marble-cloud', 'Mineral cloud', 'fbm', {
        blendMode: 'screen', opacity: 0.4, scale: 2.6, strength: 1.08, seed: 12,
        colorA: '#242a31', colorB: '#707986', displacement: 0.004
      }),
      layer('preset-marble-vein', 'White veins', 'veins', {
        blendMode: 'screen', opacity: 0.64, scale: 4.8, strength: 1.42, seed: 23,
        colorA: '#59616b', colorB: '#eef2f5', roughness: -0.08, displacement: 0
      })
    ]
  },
  {
    id: 'molten-rock',
    name: 'Molten Rock',
    description: 'Cracked dark crust with hot procedural fissures.',
    tags: ['rock', 'lava', 'cracked', 'terrain'],
    physical: {
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.48,
      specularIntensity: 0.46,
      ior: 1.46,
      sheen: 0,
      sheenRoughness: 0.7,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-lava-base', 'Crust', 'base', {
        colorA: '#100d0c', colorB: '#2d2722', roughness: 0.4
      }),
      layer('preset-lava-rock', 'Rock breakup', 'cellular', {
        blendMode: 'overlay', opacity: 0.65, scale: 4.3, strength: 1.15, seed: 9,
        colorA: '#17120f', colorB: '#504034', displacement: 0.07
      }),
      layer('preset-lava-ridges', 'Molten cracks', 'veins', {
        blendMode: 'add', opacity: 0.9, scale: 6.8, strength: 1.5, seed: 27,
        colorA: '#7a1600', colorB: '#ff9b21', roughness: -0.28, displacement: -0.018
      })
    ]
  },
  {
    id: 'alien-dermis',
    name: 'Alien Dermis',
    description: 'Organic cool dermis with spots, ridges and subtle vessel depth.',
    tags: ['organic', 'skin', 'sci-fi', 'wet'],
    physical: {
      roughness: 0.36,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.16,
      specularIntensity: 0.7,
      ior: 1.4,
      sheen: 0.22,
      sheenRoughness: 0.62,
      sheenColor: '#7cc6ad',
      transmission: 0.04,
      thickness: 0.2,
      attenuationDistance: 1.6,
      attenuationColor: '#5f9d83'
    },
    layers: [
      layer('preset-alien-base', 'Dermis', 'base', {
        colorA: '#233a3b', colorB: '#547b73', roughness: 0.22
      }),
      layer('preset-alien-cells', 'Cells', 'cellular', {
        blendMode: 'overlay', opacity: 0.54, scale: 5.4, strength: 1.1, seed: 13,
        colorA: '#1d3033', colorB: '#83aa91', displacement: 0.016
      }),
      layer('preset-alien-spots', 'Pigment', 'spots', {
        blendMode: 'multiply', opacity: 0.5, scale: 8.5, strength: 1.25, seed: 29,
        colorA: '#172125', colorB: '#7a9c85'
      }),
      layer('preset-alien-vessels', 'Vessels', 'vessels', {
        blendMode: 'screen', channel: 'color', opacity: 0.34, scale: 8.0,
        strength: 1.4, seed: 41, colorA: '#304b54', colorB: '#8bc9bf'
      })
    ]
  }
];
