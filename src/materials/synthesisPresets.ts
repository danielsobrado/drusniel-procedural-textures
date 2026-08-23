import { createPresetLayer } from './presetLayer';
import type { MaterialPreset } from './types';

export const SYNTHESIS_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'weathered-geological-strata',
    name: 'Weathered Geological Strata',
    description: 'Shared eroded strata drive color, relief, roughness, cavities and oxidation.',
    tags: ['v0.2', 'geological', 'erosion', 'structure'],
    synthesis: { age: 0.78, weathering: 0.82, gravity: -1, macro: 1.35, meso: 0.82, micro: 1.42, variation: 0.62, stochasticTiling: 0.48 },
    physical: { roughness: 0.66, clearcoat: 0.08 },
    layers: [
      createPresetLayer('geo-base', 'Iron stone', 'base', { colorA: '#211b17', colorB: '#66513c', roughness: 0.22 }),
      createPresetLayer('geo-structure', 'Eroded strata field', 'erosion', { scale: 2.2, seed: 17, opacity: 0.76, colorA: '#30261e', colorB: '#a0835d', displacement: 0.085 }),
      createPresetLayer('geo-grain', 'Mineral grain', 'cellular', { scale: 9.4, seed: 42, opacity: 0.31, colorA: '#281f18', colorB: '#c4a06c', displacement: 0.018, structureSourceLayerId: 'geo-structure' }),
      createPresetLayer('geo-ao', 'Strata cavities', 'erosion', { channel: 'ao', scale: 2.2, seed: 17, opacity: 0.68, structureSourceLayerId: 'geo-structure' }),
      createPresetLayer('geo-rust', 'Oxidized deposits', 'spots', { colorA: '#2d1b12', colorB: '#bd6631', scale: 4.7, seed: 73, opacity: 0.28, maskSourceLayerId: 'geo-structure' })
    ]
  },
  {
    id: 'reaction-diffusion-fungal',
    name: 'Reaction Diffusion Fungal',
    description: 'A reaction-diffusion colony shares its growth topology with tissue, wetness and emission.',
    tags: ['v0.2', 'biological', 'fungal', 'simulation'],
    synthesis: { age: 0.36, weathering: 0.22, gravity: -0.6, macro: 0.72, meso: 1.18, micro: 1.36, variation: 0.73, stochasticTiling: 0.36 },
    physical: { roughness: 0.42, clearcoat: 0.38, clearcoatRoughness: 0.13 },
    layers: [
      createPresetLayer('fungal-base', 'Nutrient bed', 'base', { colorA: '#101b18', colorB: '#2a3e31', roughness: 0.17 }),
      createPresetLayer('fungal-growth', 'Colony growth', 'reaction-diffusion', { scale: 3.7, seed: 29, colorA: '#163c35', colorB: '#d7b668', displacement: 0.052 }),
      createPresetLayer('fungal-tissue', 'Translucent tissue', 'sss', { channel: 'sss', colorA: '#8e3e54', colorB: '#efbd78', opacity: 0.5, structureSourceLayerId: 'fungal-growth' }),
      createPresetLayer('fungal-wet', 'Colony moisture', 'wet-film', { channel: 'clearcoat', roughness: 0.08, opacity: 0.63, structureSourceLayerId: 'fungal-growth' }),
      createPresetLayer('fungal-glow', 'Bioluminescent tips', 'reaction-diffusion', { channel: 'emissive', colorA: '#003b2f', colorB: '#67ffc8', opacity: 0.25, structureSourceLayerId: 'fungal-growth' })
    ]
  },
  {
    id: 'sdf-crystal-matrix',
    name: 'SDF Crystal Matrix',
    description: 'Distance-field crystals couple faceting, height, metallic inclusions and occlusion.',
    tags: ['v0.2', 'sdf', 'crystal', 'mineral'],
    synthesis: { age: 0.18, weathering: 0.12, gravity: -1, macro: 0.8, meso: 1.22, micro: 0.76, variation: 0.48, stochasticTiling: 0.58 },
    physical: { roughness: 0.24, clearcoat: 0.62, clearcoatRoughness: 0.08 },
    layers: [
      createPresetLayer('crystal-base', 'Obsidian matrix', 'base', { colorA: '#070b12', colorB: '#182942', roughness: -0.04 }),
      createPresetLayer('crystal-sdf', 'Crystal distance field', 'sdf', { scale: 2.8, seed: 61, colorA: '#18233d', colorB: '#b7d8e8', displacement: 0.11 }),
      createPresetLayer('crystal-metal', 'Metallic inclusions', 'sdf', { channel: 'metallic', opacity: 0.72, structureSourceLayerId: 'crystal-sdf' }),
      createPresetLayer('crystal-ao', 'Crystal sockets', 'sdf', { channel: 'ao', opacity: 0.75, structureSourceLayerId: 'crystal-sdf', maskInvert: true }),
      createPresetLayer('crystal-veins', 'Conductive veins', 'veins', { channel: 'emissive', colorA: '#071a2d', colorB: '#52aef5', scale: 2.2, opacity: 0.21 })
    ]
  }
];
