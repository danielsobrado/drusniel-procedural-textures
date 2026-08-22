import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const GRASS_EXTENSION_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'wetland-sedge',
    name: 'Wetland Sedge',
    description: 'Coarse wetland sedge with dark saturated ground, fibrous blades, dense clumps and subdued wet highlights.',
    tags: ['grass', 'vegetation', 'wetland', 'wet', 'terrain'],
    physical: {
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.05,
      clearcoatRoughness: 0.42,
      specularIntensity: 0.32,
      ior: 1.37,
      sheen: 0.3,
      sheenRoughness: 0.8,
      sheenColor: '#657c4c',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-wetland-sedge-base', 'Saturated ground', 'base', {
        colorA: '#1d271b', colorB: '#38472f', roughness: 0.14
      }),
      layer('preset-wetland-sedge-growth', 'Sedge growth', 'fbm', {
        blendMode: 'overlay', opacity: 0.5, scale: 3.5, strength: 1.3, seed: 17,
        colorA: '#294227', colorB: '#65774a', roughness: 0.04, displacement: 0.012
      }),
      layer('preset-wetland-sedge-blades', 'Coarse blades', 'ridges', {
        blendMode: 'screen', opacity: 0.38, scale: 16.8, strength: 1.56, seed: 35,
        colorA: '#3b5a39', colorB: '#91a46b', roughness: 0.03, displacement: 0.011
      }),
      layer('preset-wetland-sedge-clumps', 'Dense sedge clumps', 'cellular', {
        blendMode: 'overlay', opacity: 0.24, scale: 8.8, strength: 1.1, seed: 54,
        colorA: '#243821', colorB: '#66794d', roughness: 0.04, displacement: 0.016
      }),
      layer('preset-wetland-sedge-tips', 'Pale blade tips', 'spots', {
        blendMode: 'screen', opacity: 0.18, scale: 15.6, strength: 1.4, seed: 72,
        colorA: '#698253', colorB: '#b0bf82', roughness: -0.02, displacement: 0.002
      }),
      layer('preset-wetland-sedge-water', 'Wet sheen', 'wet-film', {
        channel: 'clearcoat', opacity: 0.16, scale: 10.2, strength: 1.08, seed: 91,
        colorA: '#455942', colorB: '#91a18c', roughness: 0.18
      })
    ]
  },
  {
    id: 'frosted-grass',
    name: 'Frosted Grass',
    description: 'Cold grass cover with muted green blades, pale frost crystals, shadowed clumps and fine frozen breakup.',
    tags: ['grass', 'vegetation', 'cold', 'frost', 'terrain'],
    physical: {
      roughness: 0.52,
      metalness: 0,
      clearcoat: 0.02,
      clearcoatRoughness: 0.56,
      specularIntensity: 0.34,
      ior: 1.38,
      sheen: 0.34,
      sheenRoughness: 0.74,
      sheenColor: '#b4c1ad',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-frosted-grass-base', 'Cold grass bed', 'base', {
        colorA: '#313a2d', colorB: '#55614b', roughness: 0.15
      }),
      layer('preset-frosted-grass-growth', 'Cold growth variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.46, scale: 3.6, strength: 1.28, seed: 20,
        colorA: '#344634', colorB: '#6f7e60', roughness: 0.04, displacement: 0.01
      }),
      layer('preset-frosted-grass-blades', 'Frozen blades', 'ridges', {
        blendMode: 'screen', opacity: 0.34, scale: 17.2, strength: 1.52, seed: 39,
        colorA: '#5c7058', colorB: '#aab9a0', roughness: 0.03, displacement: 0.008
      }),
      layer('preset-frosted-grass-crystals', 'Frost crystals', 'spots', {
        blendMode: 'screen', opacity: 0.24, scale: 18.6, strength: 1.48, seed: 57,
        colorA: '#9aa99a', colorB: '#dde5dc', roughness: -0.04, displacement: 0.002
      }),
      layer('preset-frosted-grass-clumps', 'Shadowed clumps', 'cellular', {
        blendMode: 'multiply', opacity: 0.16, scale: 9.4, strength: 1.08, seed: 76,
        colorA: '#2a3128', colorB: '#535e4d', roughness: 0.04, displacement: 0.01
      }),
      layer('preset-frosted-grass-breakup', 'Frozen micro breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.1, scale: 19.6, strength: 1.2, seed: 95,
        colorA: '#52604f', colorB: '#7d8b78', roughness: 0.02, displacement: 0.001
      })
    ]
  }
];
