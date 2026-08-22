import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const TERRAIN_EXTENSION_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'riverbank-mud',
    name: 'Riverbank Mud',
    description: 'Saturated dark riverbank soil with shallow ruts, compact clods, fine grit and patchy wet reflections.',
    tags: ['terrain', 'soil', 'mud', 'wet', 'ground'],
    physical: {
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.09,
      clearcoatRoughness: 0.34,
      specularIntensity: 0.36,
      ior: 1.44,
      sheen: 0.02,
      sheenRoughness: 0.84,
      sheenColor: '#5d5145',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-riverbank-mud-base', 'Saturated soil', 'base', {
        colorA: '#211814', colorB: '#4b372a', roughness: 0.16
      }),
      layer('preset-riverbank-mud-moisture', 'Moisture variation', 'fbm', {
        blendMode: 'overlay', opacity: 0.5, scale: 3.1, strength: 1.28, seed: 19,
        colorA: '#1b1411', colorB: '#665044', roughness: 0.03, displacement: 0.01
      }),
      layer('preset-riverbank-mud-ruts', 'Shallow ruts', 'ridges', {
        blendMode: 'multiply', opacity: 0.32, scale: 6.6, strength: 1.34, seed: 37,
        colorA: '#17110f', colorB: '#493429', roughness: 0.03, displacement: -0.018
      }),
      layer('preset-riverbank-mud-clods', 'Compacted clods', 'cellular', {
        blendMode: 'overlay', opacity: 0.3, scale: 8.4, strength: 1.12, seed: 56,
        colorA: '#2a1f19', colorB: '#6d5542', roughness: 0.05, displacement: 0.02
      }),
      layer('preset-riverbank-mud-grit', 'Embedded grit', 'spots', {
        blendMode: 'screen', opacity: 0.16, scale: 16.4, strength: 1.42, seed: 74,
        colorA: '#665343', colorB: '#a28d73', roughness: 0.04, displacement: 0.002
      }),
      layer('preset-riverbank-mud-water', 'Wet patches', 'wet-film', {
        channel: 'clearcoat', opacity: 0.3, scale: 7.8, strength: 1.16, seed: 93,
        colorA: '#40382f', colorB: '#8a8174', roughness: 0.12
      })
    ]
  },
  {
    id: 'limestone-gravel',
    name: 'Limestone Gravel',
    description: 'Pale angular limestone fragments over dusty fines with chalk variation, fractures and small mineral grit.',
    tags: ['terrain', 'rock', 'gravel', 'limestone', 'ground'],
    physical: {
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.01,
      clearcoatRoughness: 0.66,
      specularIntensity: 0.32,
      ior: 1.5,
      sheen: 0,
      sheenRoughness: 0.86,
      sheenColor: '#ffffff',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-limestone-gravel-base', 'Dusty limestone', 'base', {
        colorA: '#7e796d', colorB: '#aaa597', roughness: 0.18
      }),
      layer('preset-limestone-gravel-fragments', 'Angular fragments', 'cellular', {
        blendMode: 'overlay', opacity: 0.62, scale: 5.8, strength: 1.24, seed: 23,
        colorA: '#676359', colorB: '#c0b9a8', roughness: 0.08, displacement: 0.055
      }),
      layer('preset-limestone-gravel-chalk', 'Chalk weathering', 'fbm', {
        blendMode: 'screen', opacity: 0.28, scale: 3.7, strength: 1.22, seed: 41,
        colorA: '#918b7c', colorB: '#d0c9b8', roughness: 0.04, displacement: 0.006
      }),
      layer('preset-limestone-gravel-fractures', 'Stone fractures', 'veins', {
        blendMode: 'multiply', opacity: 0.2, scale: 8.6, strength: 1.38, seed: 59,
        colorA: '#555149', colorB: '#868177', roughness: 0.03, displacement: -0.006
      }),
      layer('preset-limestone-gravel-grit', 'Fine mineral grit', 'spots', {
        blendMode: 'screen', opacity: 0.2, scale: 17.6, strength: 1.5, seed: 78,
        colorA: '#aaa292', colorB: '#ded7c5', roughness: 0.05, displacement: 0.003
      }),
      layer('preset-limestone-gravel-breakup', 'Dust micro breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.09, scale: 19.4, strength: 1.2, seed: 96,
        colorA: '#817b70', colorB: '#aaa394', roughness: 0.02, displacement: 0.001
      })
    ]
  }
];
