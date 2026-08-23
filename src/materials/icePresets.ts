import { createPresetLayer as layer } from './presetLayer';
import type { MaterialPreset } from './types';

const CELL_STRUCTURE_ID = 'preset-ice-glacial-cells';

export const ICE_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'glacial-cell-ice',
    name: 'Glacial Cell Ice',
    description: 'Glossy translucent blue ice with rounded cellular plates, pale frosted seams, recessed boundaries and soft internal scattering.',
    tags: ['ice', 'mineral', 'crystal', 'cellular', 'translucent', 'glossy'],
    physical: {
      roughness: 0.1,
      metalness: 0,
      clearcoat: 0.78,
      clearcoatRoughness: 0.07,
      specularIntensity: 0.98,
      ior: 1.31,
      sheen: 0.08,
      sheenRoughness: 0.32,
      sheenColor: '#dffaff',
      transmission: 0.32,
      thickness: 0.82,
      attenuationDistance: 0.72,
      attenuationColor: '#6aa6bd'
    },
    synthesis: {
      age: 0,
      weathering: 0,
      gravity: 0,
      macro: 0.72,
      meso: 1.08,
      micro: 0.32,
      variation: 0.12,
      stochasticTiling: 0
    },
    layers: [
      layer('preset-ice-glacial-base', 'Deep ice body', 'base', {
        colorA: '#2f5669',
        colorB: '#4f7e91',
        roughness: 0.04
      }),
      layer(CELL_STRUCTURE_ID, 'Rounded ice cells', 'cellular', {
        blendMode: 'screen',
        opacity: 0.94,
        scale: 4.9,
        strength: 1.76,
        seed: 37,
        colorA: '#3f7188',
        colorB: '#a4cbd5',
        roughness: -0.08,
        displacement: 0.135
      }),
      layer('preset-ice-glacial-depth', 'Cell depth variation', 'cellular', {
        blendMode: 'overlay',
        channel: 'color',
        opacity: 0.34,
        scale: 4.9,
        strength: 1.44,
        seed: 37,
        colorA: '#315e74',
        colorB: '#81b5c5',
        structureSourceLayerId: CELL_STRUCTURE_ID
      }),
      layer('preset-ice-glacial-seams', 'Frosted cell seams', 'cellular', {
        blendMode: 'screen',
        channel: 'color',
        opacity: 0.78,
        scale: 4.9,
        strength: 1.7,
        seed: 37,
        colorA: '#e3f7f8',
        colorB: '#8dbac5',
        structureSourceLayerId: CELL_STRUCTURE_ID,
        maskSourceLayerId: CELL_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-ice-glacial-seam-depth', 'Recessed boundaries', 'cellular', {
        channel: 'height',
        opacity: 0.9,
        scale: 4.9,
        strength: 1.84,
        seed: 37,
        displacement: 0.105,
        structureSourceLayerId: CELL_STRUCTURE_ID,
        maskSourceLayerId: CELL_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-ice-glacial-seam-roughness', 'Frosted seam roughness', 'cellular', {
        channel: 'roughness',
        opacity: 0.46,
        scale: 4.9,
        strength: 1.66,
        seed: 37,
        roughness: 0.18,
        structureSourceLayerId: CELL_STRUCTURE_ID,
        maskSourceLayerId: CELL_STRUCTURE_ID,
        maskInvert: true,
        maskStrength: 1
      }),
      layer('preset-ice-glacial-scatter', 'Cold internal scatter', 'sss', {
        opacity: 0.56,
        scale: 4.9,
        strength: 1.34,
        seed: 37,
        colorA: '#39798f',
        colorB: '#c5eef2',
        structureSourceLayerId: CELL_STRUCTURE_ID,
        maskSourceLayerId: CELL_STRUCTURE_ID,
        maskStrength: 0.76
      }),
      layer('preset-ice-glacial-gloss', 'Polished melt film', 'wet-film', {
        opacity: 0.94,
        scale: 4.9,
        strength: 1.46,
        seed: 37,
        colorA: '#5d95a8',
        colorB: '#f0ffff',
        roughness: -0.28,
        structureSourceLayerId: CELL_STRUCTURE_ID,
        maskSourceLayerId: CELL_STRUCTURE_ID,
        maskStrength: 0.48
      }),
      layer('preset-ice-glacial-micro', 'Fine frozen microtexture', 'fbm', {
        channel: 'roughness',
        opacity: 0.1,
        scale: 18.2,
        strength: 1.18,
        seed: 71,
        roughness: 0.08
      })
    ]
  }
];
