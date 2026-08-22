import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const GRASS_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'lush-turf',
    name: 'Lush Turf',
    description: 'Dense cool-season turf with broad color variation, fibrous blades and subtle fresh highlights.',
    tags: ['grass', 'vegetation', 'terrain', 'ground'],
    physical: {
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.03,
      clearcoatRoughness: 0.46,
      specularIntensity: 0.32,
      ior: 1.38,
      sheen: 0.32,
      sheenRoughness: 0.78,
      sheenColor: '#6b8f42',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-lush-turf-base', 'Grass bed', 'base', {
        colorA: '#173016', colorB: '#315529', roughness: 0.14
      }),
      layer('preset-lush-turf-patches', 'Growth variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.52, scale: 3.4, strength: 1.28, seed: 13,
        colorA: '#264520', colorB: '#58773b', roughness: 0.04, displacement: 0.012
      }),
      layer('preset-lush-turf-blades', 'Blade fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.42, scale: 17.2, strength: 1.58, seed: 31,
        colorA: '#315b2a', colorB: '#83a64e', roughness: 0.04, displacement: 0.012
      }),
      layer('preset-lush-turf-clumps', 'Dense clumps', 'cellular', {
        blendMode: 'overlay', opacity: 0.22, scale: 9.4, strength: 1.08, seed: 49,
        colorA: '#203c1d', colorB: '#527239', roughness: 0.04, displacement: 0.014
      }),
      layer('preset-lush-turf-fresh', 'Fresh tips', 'spots', {
        blendMode: 'screen', opacity: 0.2, scale: 16.8, strength: 1.48, seed: 68,
        colorA: '#507a38', colorB: '#94ba5d', roughness: -0.05, displacement: 0.002
      })
    ]
  },
  {
    id: 'wild-meadow-grass',
    name: 'Wild Meadow Grass',
    description: 'Natural meadow cover mixing green growth, coarse fibers, dry straw and scattered seed-head tones.',
    tags: ['grass', 'vegetation', 'meadow', 'terrain'],
    physical: {
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.54,
      specularIntensity: 0.3,
      ior: 1.38,
      sheen: 0.28,
      sheenRoughness: 0.82,
      sheenColor: '#788751',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-meadow-grass-base', 'Meadow bed', 'base', {
        colorA: '#26351d', colorB: '#53603a', roughness: 0.14
      }),
      layer('preset-meadow-grass-growth', 'Growth patches', 'fbm', {
        blendMode: 'overlay', opacity: 0.54, scale: 3, strength: 1.34, seed: 17,
        colorA: '#2d4924', colorB: '#6b7c43', roughness: 0.04, displacement: 0.014
      }),
      layer('preset-meadow-grass-fibers', 'Coarse grass fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.36, scale: 15.4, strength: 1.6, seed: 37,
        colorA: '#405b30', colorB: '#94a05d', roughness: 0.06, displacement: 0.012
      }),
      layer('preset-meadow-grass-straw', 'Dry straw', 'spots', {
        blendMode: 'screen', opacity: 0.3, scale: 10.6, strength: 1.48, seed: 58,
        colorA: '#746540', colorB: '#aa9765', roughness: 0.08, displacement: 0.004
      }),
      layer('preset-meadow-grass-clumps', 'Mixed clumps', 'cellular', {
        blendMode: 'overlay', opacity: 0.18, scale: 8.6, strength: 1.12, seed: 76,
        colorA: '#293b22', colorB: '#657043', roughness: 0.04, displacement: 0.016
      }),
      layer('preset-meadow-grass-breakup', 'Fine meadow breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.12, scale: 18.4, strength: 1.3, seed: 91,
        colorA: '#3a482b', colorB: '#758052', roughness: 0.02, displacement: 0.002
      })
    ]
  },
  {
    id: 'dry-savanna-grass',
    name: 'Dry Savanna Grass',
    description: 'Sun-dried grassland with dusty olive undergrowth, straw fibers and sparse pale seed heads.',
    tags: ['grass', 'vegetation', 'dry', 'terrain'],
    physical: {
      roughness: 0.56,
      metalness: 0,
      clearcoat: 0,
      clearcoatRoughness: 0.65,
      specularIntensity: 0.24,
      ior: 1.36,
      sheen: 0.2,
      sheenRoughness: 0.86,
      sheenColor: '#a28c55',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-savanna-grass-base', 'Dusty undergrowth', 'base', {
        colorA: '#443f25', colorB: '#6a6338', roughness: 0.16
      }),
      layer('preset-savanna-grass-dryness', 'Dry variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.56, scale: 3.1, strength: 1.32, seed: 15,
        colorA: '#5d522f', colorB: '#927f49', roughness: 0.06, displacement: 0.012
      }),
      layer('preset-savanna-grass-stems', 'Dry stems', 'ridges', {
        blendMode: 'screen', opacity: 0.42, scale: 16, strength: 1.62, seed: 35,
        colorA: '#796b3e', colorB: '#b6a263', roughness: 0.06, displacement: 0.011
      }),
      layer('preset-savanna-grass-shadow', 'Sparse dark clumps', 'cellular', {
        blendMode: 'multiply', opacity: 0.18, scale: 7.8, strength: 1.08, seed: 55,
        colorA: '#3b3822', colorB: '#655f39', roughness: 0.04, displacement: 0.013
      }),
      layer('preset-savanna-grass-seeds', 'Seed heads', 'spots', {
        blendMode: 'screen', opacity: 0.24, scale: 14.6, strength: 1.52, seed: 77,
        colorA: '#8f7c4c', colorB: '#c5af70', roughness: 0.05, displacement: 0.002
      }),
      layer('preset-savanna-grass-breakup', 'Fine dry breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.1, scale: 19.2, strength: 1.26, seed: 93,
        colorA: '#5d5635', colorB: '#8d7d4d', roughness: 0.02, displacement: 0.001
      })
    ]
  },
  {
    id: 'coastal-dune-grass',
    name: 'Coastal Dune Grass',
    description: 'Salt-tolerant dune cover with sandy gaps, wind-combed fibers and sun-bleached tips.',
    tags: ['grass', 'vegetation', 'coastal', 'sand', 'terrain'],
    physical: {
      roughness: 0.54,
      metalness: 0,
      clearcoat: 0.01,
      clearcoatRoughness: 0.62,
      specularIntensity: 0.26,
      ior: 1.36,
      sheen: 0.18,
      sheenRoughness: 0.86,
      sheenColor: '#9a9a62',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-dune-grass-base', 'Sandy grass bed', 'base', {
        colorA: '#59553a', colorB: '#79734a', roughness: 0.16
      }),
      layer('preset-dune-grass-growth', 'Sparse growth', 'fbm', {
        blendMode: 'overlay', opacity: 0.48, scale: 3.8, strength: 1.28, seed: 22,
        colorA: '#4a5b34', colorB: '#7f8c50', roughness: 0.05, displacement: 0.01
      }),
      layer('preset-dune-grass-fibers', 'Wind-combed fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.38, scale: 16.4, strength: 1.56, seed: 44,
        colorA: '#68734a', colorB: '#a9ad72', roughness: 0.06, displacement: 0.009
      }),
      layer('preset-dune-grass-gaps', 'Sandy gaps', 'cellular', {
        blendMode: 'multiply', opacity: 0.18, scale: 9.2, strength: 1.08, seed: 62,
        colorA: '#5f573a', colorB: '#7f7651', roughness: 0.04, displacement: -0.008
      }),
      layer('preset-dune-grass-tips', 'Bleached tips', 'spots', {
        blendMode: 'screen', opacity: 0.22, scale: 15.8, strength: 1.46, seed: 83,
        colorA: '#8d8454', colorB: '#c7b980', roughness: 0.05, displacement: 0.002
      }),
      layer('preset-dune-grass-breakup', 'Fine salt breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.1, scale: 19.8, strength: 1.22, seed: 99,
        colorA: '#626044', colorB: '#87875b', roughness: 0.02, displacement: 0.001
      })
    ]
  },
  {
    id: 'forest-understory-grass',
    name: 'Forest Understory Grass',
    description: 'Dark shade grass with damp soil undertones, soft fibers and scattered pale new growth.',
    tags: ['grass', 'vegetation', 'forest', 'damp', 'terrain'],
    physical: {
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.03,
      clearcoatRoughness: 0.5,
      specularIntensity: 0.3,
      ior: 1.38,
      sheen: 0.26,
      sheenRoughness: 0.8,
      sheenColor: '#68784b',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-understory-grass-base', 'Shaded bed', 'base', {
        colorA: '#1d281b', colorB: '#35452c', roughness: 0.15
      }),
      layer('preset-understory-grass-growth', 'Shade growth', 'fbm', {
        blendMode: 'overlay', opacity: 0.5, scale: 3.3, strength: 1.3, seed: 25,
        colorA: '#263c22', colorB: '#5d6f43', roughness: 0.04, displacement: 0.011
      }),
      layer('preset-understory-grass-fibers', 'Soft fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.34, scale: 17.6, strength: 1.5, seed: 47,
        colorA: '#395338', colorB: '#859761', roughness: 0.03, displacement: 0.008
      }),
      layer('preset-understory-grass-soil', 'Exposed soil', 'cellular', {
        blendMode: 'multiply', opacity: 0.16, scale: 10.2, strength: 1.06, seed: 66,
        colorA: '#1e1b16', colorB: '#4d4937', roughness: 0.06, displacement: -0.007
      }),
      layer('preset-understory-grass-tips', 'Pale new growth', 'spots', {
        blendMode: 'screen', opacity: 0.18, scale: 16.2, strength: 1.42, seed: 85,
        colorA: '#5e7950', colorB: '#a5b47b', roughness: -0.03, displacement: 0.002
      }),
      layer('preset-understory-grass-damp', 'Damp sheen', 'wet-film', {
        channel: 'clearcoat', opacity: 0.12, scale: 11.4, strength: 1.08, seed: 98,
        colorA: '#485b42', colorB: '#8fa08a', roughness: 0.2
      })
    ]
  }
];
