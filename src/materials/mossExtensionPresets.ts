import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

export const MOSS_EXTENSION_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'sheet-moss',
    name: 'Sheet Moss',
    description: 'Low woodland moss forming dense overlapping mats with fine fibers, fresh tips and a restrained damp sheen.',
    tags: ['moss', 'organic', 'forest', 'ground', 'terrain'],
    physical: {
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.46,
      specularIntensity: 0.3,
      ior: 1.37,
      sheen: 0.28,
      sheenRoughness: 0.82,
      sheenColor: '#70884b',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-sheet-moss-base', 'Dark woodland bed', 'base', {
        colorA: '#182016', colorB: '#303c24', roughness: 0.15
      }),
      layer('preset-sheet-moss-growth', 'Overlapping mats', 'fbm', {
        blendMode: 'overlay', opacity: 0.52, scale: 3.8, strength: 1.28, seed: 18,
        colorA: '#273a20', colorB: '#607b3d', roughness: 0.05, displacement: 0.012
      }),
      layer('preset-sheet-moss-cells', 'Mat clusters', 'cellular', {
        blendMode: 'overlay', opacity: 0.38, scale: 7.6, strength: 1.12, seed: 36,
        colorA: '#29401f', colorB: '#738b47', roughness: 0.04, displacement: 0.024
      }),
      layer('preset-sheet-moss-fibers', 'Fine leaf fibers', 'ridges', {
        blendMode: 'screen', opacity: 0.28, scale: 17.8, strength: 1.48, seed: 54,
        colorA: '#3f5a31', colorB: '#98aa66', roughness: 0.02, displacement: 0.005,
        maskSourceLayerId: 'preset-sheet-moss-cells', maskStrength: 0.82
      }),
      layer('preset-sheet-moss-tips', 'Fresh leaf tips', 'spots', {
        blendMode: 'screen', opacity: 0.2, scale: 15.8, strength: 1.42, seed: 73,
        colorA: '#607b3f', colorB: '#b2c47d', roughness: -0.03, displacement: 0.002
      }),
      layer('preset-sheet-moss-damp', 'Damp sheen', 'wet-film', {
        channel: 'clearcoat', opacity: 0.13, scale: 10.6, strength: 1.08, seed: 91,
        colorA: '#4d6045', colorB: '#94a48e', roughness: 0.2
      })
    ]
  },
  {
    id: 'reindeer-lichen',
    name: 'Reindeer Lichen',
    description: 'Dry pale lichen with branching coral-like ridges, compact colonies and cool mineral shadowing.',
    tags: ['moss', 'lichen', 'dry', 'stone', 'terrain'],
    physical: {
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0,
      clearcoatRoughness: 0.72,
      specularIntensity: 0.26,
      ior: 1.44,
      sheen: 0.1,
      sheenRoughness: 0.92,
      sheenColor: '#c1c5ad',
      transmission: 0,
      thickness: 0,
      attenuationDistance: 2,
      attenuationColor: '#ffffff'
    },
    layers: [
      layer('preset-reindeer-lichen-base', 'Cool stone bed', 'base', {
        colorA: '#3f423c', colorB: '#62665b', roughness: 0.18
      }),
      layer('preset-reindeer-lichen-colonies', 'Pale colonies', 'cellular', {
        blendMode: 'screen', opacity: 0.52, scale: 6.2, strength: 1.2, seed: 21,
        colorA: '#737967', colorB: '#b9c0a4', roughness: 0.08, displacement: 0.02
      }),
      layer('preset-reindeer-lichen-branches', 'Branching lobes', 'ridges', {
        blendMode: 'screen', opacity: 0.34, scale: 12.6, strength: 1.5, seed: 42,
        colorA: '#8d927d', colorB: '#d2d6bf', roughness: 0.04, displacement: 0.009,
        maskSourceLayerId: 'preset-reindeer-lichen-colonies', maskStrength: 0.9
      }),
      layer('preset-reindeer-lichen-tips', 'Dry bright tips', 'spots', {
        blendMode: 'screen', opacity: 0.18, scale: 16.8, strength: 1.38, seed: 61,
        colorA: '#a4a995', colorB: '#e0e2d0', roughness: 0.05, displacement: 0.002,
        maskSourceLayerId: 'preset-reindeer-lichen-colonies', maskStrength: 0.78
      }),
      layer('preset-reindeer-lichen-mineral', 'Mineral shadowing', 'fbm', {
        blendMode: 'multiply', opacity: 0.16, scale: 19.2, strength: 1.2, seed: 83,
        colorA: '#4c5048', colorB: '#777b6d', roughness: 0.02, displacement: 0.001
      })
    ]
  }
];
