import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const MOSS_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'forest-moss-carpet',
    name: 'Forest Moss Carpet',
    description: 'Dense woodland moss with soft cushions, fine fibers, fresh tips and restrained dew.',
    tags: ['moss', 'organic', 'terrain', 'wet'],
    physical: {
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.06,
      clearcoatRoughness: 0.42,
      specularIntensity: 0.34,
      ior: 1.38,
      sheen: 0.24,
      sheenRoughness: 0.78,
      sheenColor: '#6e8e45',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-forest-moss-base', 'Dark moss bed', 'base', {
        colorA: '#182814', colorB: '#304722', roughness: 0.16
      }),
      layer('preset-forest-moss-patches', 'Broad growth patches', 'fbm', {
        blendMode: 'overlay', opacity: 0.55, scale: 3.1, strength: 1.25, seed: 14,
        colorA: '#293d20', colorB: '#5c7637', roughness: 0.06, displacement: 0.014
      }),
      layer('preset-forest-moss-cushions', 'Cushion clusters', 'cellular', {
        blendMode: 'overlay', opacity: 0.54, scale: 6.4, strength: 1.15, seed: 32,
        colorA: '#2d431f', colorB: '#718d41', roughness: 0.06, displacement: 0.042
      }),
      layer('preset-forest-moss-fibers', 'Fine moss fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.31, scale: 16.2, strength: 1.58, seed: 47,
        colorA: '#345027', colorB: '#96b258', roughness: 0.02, displacement: 0.008,
        maskSourceLayerId: 'preset-forest-moss-cushions', maskStrength: 0.82
      }),
      layer('preset-forest-moss-tips', 'Fresh growth tips', 'spots', {
        blendMode: 'screen', opacity: 0.3, scale: 14.4, strength: 1.46, seed: 63,
        colorA: '#51702d', colorB: '#a8c363', roughness: -0.06, displacement: 0.004,
        maskSourceLayerId: 'preset-forest-moss-patches', maskStrength: 0.7
      }),
      layer('preset-forest-moss-dew', 'Dew film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.18, scale: 12.8, strength: 1.08, seed: 79,
        colorA: '#607c48', colorB: '#cbd9b2', roughness: 0.16
      }),
      layer('preset-forest-moss-breakup', 'Micro moss breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.1, scale: 20, strength: 1.24, seed: 97,
        colorA: '#314526', colorB: '#6e8647', roughness: 0.02, displacement: 0.001
      })
    ]
  },
  {
    id: 'mossy-stone',
    name: 'Mossy Stone',
    description: 'Cool weathered stone broken by irregular moss colonies and damp fibrous edges.',
    tags: ['moss', 'stone', 'terrain', 'weathered'],
    physical: {
      roughness: 0.44,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.46,
      specularIntensity: 0.42,
      ior: 1.46,
      sheen: 0.1,
      sheenRoughness: 0.76,
      sheenColor: '#667f52',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-mossy-stone-base', 'Weathered stone', 'base', {
        colorA: '#343a37', colorB: '#62685d', roughness: 0.16
      }),
      layer('preset-mossy-stone-breakup', 'Stone breakup', 'cellular', {
        blendMode: 'overlay', opacity: 0.44, scale: 4.1, strength: 1.1, seed: 18,
        colorA: '#252b29', colorB: '#777c6f', roughness: 0.08, displacement: 0.042
      }),
      layer('preset-mossy-stone-colonies', 'Moss colonies', 'spots', {
        blendMode: 'overlay', opacity: 0.78, scale: 4.4, strength: 1.62, seed: 36,
        colorA: '#1c2e17', colorB: '#66833a', roughness: 0.06, displacement: 0.028
      }),
      layer('preset-mossy-stone-fibers', 'Colony fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.38, scale: 13.2, strength: 1.65, seed: 54,
        colorA: '#35512a', colorB: '#9bb75a', roughness: 0.02, displacement: 0.008,
        maskSourceLayerId: 'preset-mossy-stone-colonies', maskStrength: 0.92
      }),
      layer('preset-mossy-stone-damp', 'Damp stone film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.32, scale: 6.8, strength: 1.12, seed: 71,
        colorA: '#49584b', colorB: '#a6b4a2', roughness: 0.2
      })
    ]
  },
  {
    id: 'cushion-moss',
    name: 'Cushion Moss',
    description: 'Rounded emerald moss cushions over dark peat with mottled leaves and bright new growth.',
    tags: ['moss', 'organic', 'ground', 'lush'],
    physical: {
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.5,
      specularIntensity: 0.3,
      ior: 1.36,
      sheen: 0.3,
      sheenRoughness: 0.82,
      sheenColor: '#73974c',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-cushion-moss-peat', 'Peat bed', 'base', {
        colorA: '#171b12', colorB: '#292f1d', roughness: 0.14
      }),
      layer('preset-cushion-moss-domes', 'Moss cushions', 'cellular', {
        blendMode: 'overlay', opacity: 0.82, scale: 4.8, strength: 1.3, seed: 21,
        colorA: '#23431d', colorB: '#6d973d', roughness: 0.06, displacement: 0.074
      }),
      layer('preset-cushion-moss-leaves', 'Leaf mottling', 'fbm', {
        blendMode: 'overlay', opacity: 0.48, scale: 10.4, strength: 1.45, seed: 43,
        colorA: '#355b26', colorB: '#8daf4d', roughness: 0.03, displacement: 0.012,
        maskSourceLayerId: 'preset-cushion-moss-domes', maskStrength: 0.88
      }),
      layer('preset-cushion-moss-tips', 'Bright tips', 'spots', {
        blendMode: 'screen', opacity: 0.4, scale: 15.6, strength: 1.72, seed: 66,
        colorA: '#557a32', colorB: '#b6d36a', roughness: -0.05, displacement: 0.005,
        maskSourceLayerId: 'preset-cushion-moss-domes', maskStrength: 0.96
      }),
      layer('preset-cushion-moss-moisture', 'Moisture', 'wet-film', {
        channel: 'clearcoat', opacity: 0.2, scale: 8.4, strength: 1.08, seed: 84,
        colorA: '#4f6941', colorB: '#cad9b0', roughness: 0.18
      })
    ]
  },
  {
    id: 'crustose-lichen',
    name: 'Crustose Lichen',
    description: 'Pale crust-forming lichen spreading across cool weathered rock with powdery mineral edges.',
    tags: ['moss', 'lichen', 'stone', 'weathered', 'terrain'],
    physical: {
      roughness: 0.56,
      metalness: 0,
      clearcoat: 0.01,
      clearcoatRoughness: 0.66,
      specularIntensity: 0.28,
      ior: 1.46,
      sheen: 0.08,
      sheenRoughness: 0.9,
      sheenColor: '#aeb38b',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-lichen-base', 'Weathered rock', 'base', {
        colorA: '#3b403d', colorB: '#626862', roughness: 0.18
      }),
      layer('preset-lichen-rock', 'Rock breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.4, scale: 4.2, strength: 1.2, seed: 24,
        colorA: '#303532', colorB: '#74786f', roughness: 0.06, displacement: 0.018
      }),
      layer('preset-lichen-colonies', 'Lichen plates', 'cellular', {
        blendMode: 'screen', opacity: 0.5, scale: 7.8, strength: 1.24, seed: 46,
        colorA: '#67705b', colorB: '#aeb780', roughness: 0.08, displacement: 0.014
      }),
      layer('preset-lichen-pigment', 'Olive pigment', 'spots', {
        blendMode: 'overlay', opacity: 0.24, scale: 13.6, strength: 1.44, seed: 64,
        colorA: '#626947', colorB: '#9ca56e', roughness: 0.04, displacement: 0.003,
        maskSourceLayerId: 'preset-lichen-colonies', maskStrength: 0.86
      }),
      layer('preset-lichen-edges', 'Powdery edges', 'ridges', {
        blendMode: 'screen', opacity: 0.2, scale: 18.6, strength: 1.48, seed: 82,
        colorA: '#8c9278', colorB: '#c8ccb0', roughness: 0.06, displacement: 0.002,
        maskSourceLayerId: 'preset-lichen-colonies', maskStrength: 0.78
      }),
      layer('preset-lichen-breakup', 'Micro mineral breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.09, scale: 20, strength: 1.2, seed: 94,
        colorA: '#5e6458', colorB: '#8b927c', roughness: 0.02, displacement: 0.001
      })
    ]
  },
  {
    id: 'bog-moss',
    name: 'Bog Moss',
    description: 'Waterlogged sphagnum-style moss with dark peat gaps, soft hummocks and restrained wet highlights.',
    tags: ['moss', 'bog', 'wet', 'organic', 'terrain'],
    physical: {
      roughness: 0.44,
      metalness: 0,
      clearcoat: 0.07,
      clearcoatRoughness: 0.4,
      specularIntensity: 0.34,
      ior: 1.36,
      sheen: 0.28,
      sheenRoughness: 0.8,
      sheenColor: '#748b50',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-bog-moss-base', 'Dark peat', 'base', {
        colorA: '#191b12', colorB: '#30331f', roughness: 0.15
      }),
      layer('preset-bog-moss-growth', 'Sphagnum growth', 'fbm', {
        blendMode: 'overlay', opacity: 0.5, scale: 3.6, strength: 1.28, seed: 27,
        colorA: '#334421', colorB: '#71834a', roughness: 0.04, displacement: 0.014
      }),
      layer('preset-bog-moss-hummocks', 'Soft hummocks', 'cellular', {
        blendMode: 'overlay', opacity: 0.46, scale: 7.2, strength: 1.12, seed: 49,
        colorA: '#2d3a20', colorB: '#768d4b', roughness: 0.04, displacement: 0.032
      }),
      layer('preset-bog-moss-fibers', 'Wet fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.28, scale: 17.4, strength: 1.5, seed: 67,
        colorA: '#465c31', colorB: '#9baa67', roughness: 0.01, displacement: 0.006,
        maskSourceLayerId: 'preset-bog-moss-hummocks', maskStrength: 0.84
      }),
      layer('preset-bog-moss-tips', 'Pale moss tips', 'spots', {
        blendMode: 'screen', opacity: 0.22, scale: 15.2, strength: 1.42, seed: 86,
        colorA: '#6e7f4a', colorB: '#b7c583', roughness: -0.04, displacement: 0.002
      }),
      layer('preset-bog-moss-water', 'Water film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.24, scale: 9.6, strength: 1.1, seed: 96,
        colorA: '#475740', colorB: '#9cab91', roughness: 0.15
      })
    ]
  }
];
