import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const BIOLOGICAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'lobular-adipose',
    name: 'Lobular Adipose',
    description: 'Pale pink adipose tissue with rounded fat lobules, connective septa, subtle capillaries and a moist translucent surface.',
    tags: ['biological', 'organic', 'tissue', 'adipose', 'sss', 'wet'],
    physical: {
      roughness: 0.28,
      metalness: 0,
      clearcoat: 0.28,
      clearcoatRoughness: 0.12,
      specularIntensity: 0.72,
      ior: 1.38,
      sheen: 0.22,
      sheenRoughness: 0.54,
      sheenColor: '#f0b8b0',
      transmission: 0.08,
      thickness: 0.46,
      attenuationDistance: 1.1,
      attenuationColor: '#e99a8d'
    },
    layers: [
      layer('preset-bio-lobular-base', 'Pale adipose bed', 'base', {
        colorA: '#d59d96', colorB: '#efc9c0', roughness: 0.12
      }),
      layer('preset-bio-lobular-stroma', 'Soft stromal variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.38, scale: 2.6, strength: 1.18, seed: 11,
        colorA: '#bd7f7d', colorB: '#f4d7cc', roughness: 0.03, displacement: 0.018
      }),
      layer('preset-bio-lobular-cells', 'Fat lobules', 'cellular', {
        blendMode: 'screen', opacity: 0.78, scale: 5.8, strength: 1.28, seed: 24,
        colorA: '#c98d88', colorB: '#f5d8cf', roughness: -0.03, displacement: 0.065
      }),
      layer('preset-bio-lobular-septa', 'Connective septa', 'ridges', {
        blendMode: 'screen', opacity: 0.42, scale: 8.8, strength: 1.48, seed: 39,
        colorA: '#c88f8a', colorB: '#f7dfd7', roughness: 0.02, displacement: 0.012,
        maskSourceLayerId: 'preset-bio-lobular-cells', maskStrength: 0.8
      }),
      layer('preset-bio-lobular-capillary', 'Capillary blush', 'spots', {
        blendMode: 'multiply', opacity: 0.2, scale: 13.2, strength: 1.36, seed: 52,
        colorA: '#8f4448', colorB: '#d98580', roughness: -0.02, displacement: 0.002
      }),
      layer('preset-bio-lobular-vessels', 'Fine vessels', 'vessels', {
        blendMode: 'multiply', channel: 'color', opacity: 0.24, scale: 10.4, strength: 1.38, seed: 66,
        colorA: '#7d2830', colorB: '#c45a5d'
      }),
      layer('preset-bio-lobular-sss', 'Subsurface warmth', 'sss', {
        channel: 'sss', opacity: 0.72, scale: 3.6, strength: 1.22, seed: 78,
        colorA: '#ef9a80', colorB: '#b94d54'
      }),
      layer('preset-bio-lobular-wet', 'Moist membrane', 'wet-film', {
        channel: 'clearcoat', opacity: 0.64, scale: 8.2, strength: 1.12, seed: 91,
        colorA: '#d89f99', colorB: '#fff0e9', roughness: -0.14
      })
    ]
  },
  {
    id: 'vascular-adipose',
    name: 'Vascular Adipose',
    description: 'Deep red vascular fat with swollen lobules, diffuse blood perfusion, capillary networks and a glossy wet membrane.',
    tags: ['biological', 'organic', 'tissue', 'adipose', 'vascular', 'sss', 'wet'],
    physical: {
      roughness: 0.24,
      metalness: 0,
      clearcoat: 0.42,
      clearcoatRoughness: 0.09,
      specularIntensity: 0.82,
      ior: 1.38,
      sheen: 0.18,
      sheenRoughness: 0.5,
      sheenColor: '#b94f4d',
      transmission: 0.06,
      thickness: 0.5,
      attenuationDistance: 0.9,
      attenuationColor: '#8e272b'
    },
    layers: [
      layer('preset-bio-vascular-base', 'Perfused tissue bed', 'base', {
        colorA: '#562326', colorB: '#8c4547', roughness: 0.12
      }),
      layer('preset-bio-vascular-lobules', 'Swollen lobules', 'cellular', {
        blendMode: 'overlay', opacity: 0.78, scale: 5.4, strength: 1.3, seed: 14,
        colorA: '#67282c', colorB: '#b45b57', roughness: -0.03, displacement: 0.058
      }),
      layer('preset-bio-vascular-perfusion', 'Blood perfusion', 'fbm', {
        blendMode: 'multiply', opacity: 0.54, scale: 2.8, strength: 1.28, seed: 29,
        colorA: '#3b171b', colorB: '#b93d3b', roughness: -0.06, displacement: 0.01
      }),
      layer('preset-bio-vascular-pools', 'Blood-rich pockets', 'spots', {
        blendMode: 'screen', opacity: 0.3, scale: 7.6, strength: 1.44, seed: 41,
        colorA: '#73161b', colorB: '#d44f45', roughness: -0.1, displacement: 0.003
      }),
      layer('preset-bio-vascular-vessels', 'Branching vessels', 'vessels', {
        blendMode: 'multiply', channel: 'color', opacity: 0.62, scale: 8.2, strength: 1.48, seed: 57,
        colorA: '#3e1017', colorB: '#c73638'
      }),
      layer('preset-bio-vascular-fascia', 'Pale fascia strands', 'ridges', {
        blendMode: 'screen', opacity: 0.24, scale: 9.2, strength: 1.34, seed: 69,
        colorA: '#9d5a58', colorB: '#e5aaa0', roughness: -0.02, displacement: 0.007
      }),
      layer('preset-bio-vascular-sss', 'Deep red subsurface', 'sss', {
        channel: 'sss', opacity: 0.78, scale: 3.0, strength: 1.26, seed: 82,
        colorA: '#b43e3b', colorB: '#58141a'
      }),
      layer('preset-bio-vascular-wet', 'Wet serosal film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.86, scale: 6.6, strength: 1.14, seed: 95,
        colorA: '#8f4d4a', colorB: '#f0b6aa', roughness: -0.24
      })
    ]
  },
  {
    id: 'yellow-adipose',
    name: 'Yellow Adipose',
    description: 'Warm yellow subcutaneous fat with broad buttery lobules, creamy septa, amber depth and a smooth moist surface.',
    tags: ['biological', 'organic', 'tissue', 'adipose', 'sss', 'wet'],
    physical: {
      roughness: 0.26,
      metalness: 0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.1,
      specularIntensity: 0.76,
      ior: 1.39,
      sheen: 0.2,
      sheenRoughness: 0.56,
      sheenColor: '#e6bc69',
      transmission: 0.09,
      thickness: 0.52,
      attenuationDistance: 1.15,
      attenuationColor: '#d99443'
    },
    layers: [
      layer('preset-bio-yellow-base', 'Warm fat bed', 'base', {
        colorA: '#c8903d', colorB: '#e8bd68', roughness: 0.14
      }),
      layer('preset-bio-yellow-lobules', 'Buttery lobules', 'cellular', {
        blendMode: 'screen', opacity: 0.8, scale: 4.8, strength: 1.24, seed: 17,
        colorA: '#c28a39', colorB: '#f2ce7c', roughness: -0.05, displacement: 0.07
      }),
      layer('preset-bio-yellow-marbled', 'Fat marbling', 'fbm', {
        blendMode: 'overlay', opacity: 0.34, scale: 2.3, strength: 1.18, seed: 31,
        colorA: '#ad722f', colorB: '#efd084', roughness: 0.02, displacement: 0.012
      }),
      layer('preset-bio-yellow-septa', 'Creamy septa', 'ridges', {
        blendMode: 'screen', opacity: 0.3, scale: 8.0, strength: 1.4, seed: 46,
        colorA: '#c79a54', colorB: '#f6deb0', roughness: -0.02, displacement: 0.01,
        maskSourceLayerId: 'preset-bio-yellow-lobules', maskStrength: 0.82
      }),
      layer('preset-bio-yellow-depth', 'Amber depth', 'spots', {
        blendMode: 'multiply', opacity: 0.18, scale: 11.2, strength: 1.28, seed: 59,
        colorA: '#8c5c2b', colorB: '#c68e47', roughness: 0.02, displacement: 0.002
      }),
      layer('preset-bio-yellow-sss', 'Golden subsurface', 'sss', {
        channel: 'sss', opacity: 0.62, scale: 2.7, strength: 1.18, seed: 73,
        colorA: '#e69a3e', colorB: '#b76831'
      }),
      layer('preset-bio-yellow-wet', 'Smooth wet film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.72, scale: 5.8, strength: 1.1, seed: 86,
        colorA: '#d6a452', colorB: '#fff0c6', roughness: -0.18
      }),
      layer('preset-bio-yellow-micro', 'Fine lipid breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.1, scale: 18.5, strength: 1.16, seed: 97,
        colorA: '#bd8a42', colorB: '#e4b968', roughness: 0.01, displacement: 0.002
      })
    ]
  },
  {
    id: 'fibrotic-fascia',
    name: 'Fibrotic Fascia',
    description: 'Dense pale connective tissue with layered collagen bundles, crossing scar fibers, subtle vessels and restrained moisture.',
    tags: ['biological', 'organic', 'tissue', 'fascia', 'fibrous', 'sss'],
    physical: {
      roughness: 0.36,
      metalness: 0,
      clearcoat: 0.14,
      clearcoatRoughness: 0.2,
      specularIntensity: 0.56,
      ior: 1.4,
      sheen: 0.34,
      sheenRoughness: 0.68,
      sheenColor: '#d7c8bd',
      transmission: 0.04,
      thickness: 0.3,
      attenuationDistance: 1.5,
      attenuationColor: '#c8958d'
    },
    layers: [
      layer('preset-bio-fascia-base', 'Fibrous tissue bed', 'base', {
        colorA: '#a9978f', colorB: '#d8cbc1', roughness: 0.16
      }),
      layer('preset-bio-fascia-density', 'Scar density', 'fbm', {
        blendMode: 'overlay', opacity: 0.36, scale: 3.4, strength: 1.2, seed: 12,
        colorA: '#8f7c77', colorB: '#ddd1c6', roughness: 0.06, displacement: 0.014
      }),
      layer('preset-bio-fascia-bundles', 'Collagen bundles', 'ridges', {
        blendMode: 'screen', opacity: 0.66, scale: 6.4, strength: 1.6, seed: 28,
        colorA: '#b59f95', colorB: '#eee4da', roughness: 0.04, displacement: 0.035
      }),
      layer('preset-bio-fascia-crossfibers', 'Crossing fibers', 'veins', {
        blendMode: 'screen', opacity: 0.4, scale: 10.6, strength: 1.46, seed: 43,
        colorA: '#ad938b', colorB: '#f1ded1', roughness: 0.02, displacement: 0.012
      }),
      layer('preset-bio-fascia-nodules', 'Fibrotic nodules', 'spots', {
        blendMode: 'overlay', opacity: 0.16, scale: 15.6, strength: 1.3, seed: 57,
        colorA: '#9e8c85', colorB: '#d7c7ba', roughness: 0.04, displacement: 0.003
      }),
      layer('preset-bio-fascia-vessels', 'Sparse vessels', 'vessels', {
        blendMode: 'multiply', channel: 'color', opacity: 0.18, scale: 11.4, strength: 1.34, seed: 71,
        colorA: '#7f4a4b', colorB: '#bf7772'
      }),
      layer('preset-bio-fascia-sss', 'Subsurface tissue', 'sss', {
        channel: 'sss', opacity: 0.36, scale: 4.2, strength: 1.12, seed: 84,
        colorA: '#d89b8f', colorB: '#a65f5f'
      }),
      layer('preset-bio-fascia-wet', 'Thin moisture film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.24, scale: 7.8, strength: 1.06, seed: 96,
        colorA: '#c6b3aa', colorB: '#f1e4dc', roughness: -0.08
      })
    ]
  },
  {
    id: 'granulation-tissue',
    name: 'Granulation Tissue',
    description: 'Moist red healing tissue with granular nodules, dense capillary growth, fibrin strands and strong subsurface blood depth.',
    tags: ['biological', 'organic', 'tissue', 'vascular', 'sss', 'wet'],
    physical: {
      roughness: 0.25,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.1,
      specularIntensity: 0.78,
      ior: 1.38,
      sheen: 0.16,
      sheenRoughness: 0.5,
      sheenColor: '#c85f5b',
      transmission: 0.05,
      thickness: 0.48,
      attenuationDistance: 0.95,
      attenuationColor: '#9f2d33'
    },
    layers: [
      layer('preset-bio-granulation-base', 'Healing tissue bed', 'base', {
        colorA: '#70292d', colorB: '#a94a4b', roughness: 0.12
      }),
      layer('preset-bio-granulation-nodules', 'Granular nodules', 'cellular', {
        blendMode: 'overlay', opacity: 0.76, scale: 7.6, strength: 1.34, seed: 16,
        colorA: '#7f3034', colorB: '#c6665f', roughness: -0.03, displacement: 0.05
      }),
      layer('preset-bio-granulation-edema', 'Edema variation', 'fbm', {
        blendMode: 'screen', opacity: 0.42, scale: 3.1, strength: 1.24, seed: 30,
        colorA: '#863438', colorB: '#d58378', roughness: -0.04, displacement: 0.01
      }),
      layer('preset-bio-granulation-capillaries', 'Capillary buds', 'spots', {
        blendMode: 'screen', opacity: 0.34, scale: 13.5, strength: 1.46, seed: 44,
        colorA: '#8c242a', colorB: '#e05d51', roughness: -0.08, displacement: 0.003
      }),
      layer('preset-bio-granulation-vessels', 'Dense vessels', 'vessels', {
        blendMode: 'multiply', channel: 'color', opacity: 0.64, scale: 7.6, strength: 1.52, seed: 58,
        colorA: '#451119', colorB: '#c13237'
      }),
      layer('preset-bio-granulation-fibrin', 'Fibrin strands', 'ridges', {
        blendMode: 'screen', opacity: 0.22, scale: 10.5, strength: 1.32, seed: 70,
        colorA: '#b36b61', colorB: '#e7a99a', roughness: 0.01, displacement: 0.006
      }),
      layer('preset-bio-granulation-sss', 'Blood-rich subsurface', 'sss', {
        channel: 'sss', opacity: 0.78, scale: 3.4, strength: 1.28, seed: 83,
        colorA: '#c7423f', colorB: '#65151d'
      }),
      layer('preset-bio-granulation-wet', 'Moist surface film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.82, scale: 6.2, strength: 1.14, seed: 96,
        colorA: '#a64f4d', colorB: '#efb0a6', roughness: -0.22
      })
    ]
  },
  {
    id: 'necrotic-adipose',
    name: 'Necrotic Adipose',
    description: 'Damaged pale adipose with collapsed lobules, grey-yellow mottling, darker breakdown pockets and a subdued oily film.',
    tags: ['biological', 'organic', 'tissue', 'adipose', 'necrotic'],
    physical: {
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.3,
      specularIntensity: 0.46,
      ior: 1.39,
      sheen: 0.12,
      sheenRoughness: 0.74,
      sheenColor: '#b5ad80',
      transmission: 0.02,
      thickness: 0.32,
      attenuationDistance: 1.6,
      attenuationColor: '#9e895b'
    },
    layers: [
      layer('preset-bio-necrotic-base', 'Devitalized fat bed', 'base', {
        colorA: '#7f7959', colorB: '#b5ac7e', roughness: 0.18
      }),
      layer('preset-bio-necrotic-collapse', 'Collapsed lobules', 'cellular', {
        blendMode: 'overlay', opacity: 0.62, scale: 5.6, strength: 1.24, seed: 15,
        colorA: '#746e52', colorB: '#c2b98b', roughness: 0.04, displacement: 0.04
      }),
      layer('preset-bio-necrotic-mottle', 'Grey-yellow mottling', 'fbm', {
        blendMode: 'multiply', opacity: 0.46, scale: 3.3, strength: 1.28, seed: 29,
        colorA: '#5e5b47', colorB: '#aa9b6b', roughness: 0.06, displacement: 0.008
      }),
      layer('preset-bio-necrotic-breakdown', 'Breakdown pockets', 'spots', {
        blendMode: 'multiply', opacity: 0.32, scale: 8.8, strength: 1.4, seed: 43,
        colorA: '#4b4936', colorB: '#85774e', roughness: 0.04, displacement: -0.006
      }),
      layer('preset-bio-necrotic-septa', 'Chalky septa', 'ridges', {
        blendMode: 'screen', opacity: 0.24, scale: 12.4, strength: 1.34, seed: 58,
        colorA: '#96906d', colorB: '#d2c99d', roughness: 0.04, displacement: 0.005
      }),
      layer('preset-bio-necrotic-sss', 'Faint subsurface depth', 'sss', {
        channel: 'sss', opacity: 0.2, scale: 4.0, strength: 1.08, seed: 72,
        colorA: '#b48858', colorB: '#785b44'
      }),
      layer('preset-bio-necrotic-oil', 'Subdued oily film', 'wet-film', {
        channel: 'clearcoat', opacity: 0.28, scale: 8.6, strength: 1.06, seed: 85,
        colorA: '#908663', colorB: '#cfc39a', roughness: -0.06
      }),
      layer('preset-bio-necrotic-micro', 'Fine tissue breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.12, scale: 18.8, strength: 1.18, seed: 98,
        colorA: '#75705a', colorB: '#a79d79', roughness: 0.02, displacement: 0.001
      })
    ]
  }
];
