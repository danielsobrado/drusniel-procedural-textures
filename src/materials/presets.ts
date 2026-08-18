import type { LayerKind, MaterialLayer, MaterialPreset } from './types';

function layer(
  id: string,
  name: string,
  kind: LayerKind,
  overrides: Partial<MaterialLayer> = {}
): MaterialLayer {
  return {
    id,
    name,
    kind,
    enabled: true,
    blendMode: 'normal',
    opacity: 1,
    scale: 3,
    strength: 1,
    seed: 1,
    colorA: '#545862',
    colorB: '#d8dce6',
    roughness: 0,
    displacement: 0,
    ...overrides
  };
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'adipose-v7',
    name: 'Adipose Tissue',
    description: 'Warm layered biological tissue with fascia, lobules and vascular detail.',
    physical: {
      roughness: 0.31,
      metalness: 0,
      clearcoat: 0.82,
      clearcoatRoughness: 0.12,
      specularIntensity: 0.78,
      ior: 1.38
    },
    layers: [
      layer('preset-adipose-base', 'Deep fat', 'base', {
        colorA: '#d78b25',
        colorB: '#f2bf72',
        roughness: 0.18
      }),
      layer('preset-adipose-clouds', 'Cloudy fat', 'fbm', {
        blendMode: 'screen',
        opacity: 0.62,
        scale: 2.2,
        strength: 1.15,
        seed: 8,
        colorA: '#c87820',
        colorB: '#f6d49c',
        roughness: 0.12,
        displacement: 0.045
      }),
      layer('preset-adipose-lobules', 'Lobules', 'cellular', {
        blendMode: 'overlay',
        opacity: 0.46,
        scale: 4.5,
        strength: 1.05,
        seed: 17,
        colorA: '#d88f37',
        colorB: '#f4d9a9',
        roughness: 0.08,
        displacement: 0.035
      }),
      layer('preset-adipose-fascia', 'Fascia', 'ridges', {
        blendMode: 'screen',
        opacity: 0.34,
        scale: 7.5,
        strength: 1.3,
        seed: 31,
        colorA: '#d47c67',
        colorB: '#f5cab5',
        roughness: -0.08,
        displacement: 0.007
      }),
      layer('preset-adipose-veins', 'Capillaries', 'veins', {
        blendMode: 'multiply',
        opacity: 0.46,
        scale: 8.2,
        strength: 1.25,
        seed: 44,
        colorA: '#8e3138',
        colorB: '#cf6d68',
        roughness: -0.05,
        displacement: 0.002
      })
    ]
  },
  {
    id: 'storm-marble',
    name: 'Storm Marble',
    description: 'Dark stone with layered mineral veins and soft depth.',
    physical: {
      roughness: 0.24,
      metalness: 0,
      clearcoat: 0.18,
      clearcoatRoughness: 0.2,
      specularIntensity: 0.68,
      ior: 1.5
    },
    layers: [
      layer('preset-marble-base', 'Stone', 'base', {
        colorA: '#181c21',
        colorB: '#353c44',
        roughness: 0.32
      }),
      layer('preset-marble-cloud', 'Mineral cloud', 'fbm', {
        blendMode: 'screen',
        opacity: 0.44,
        scale: 2.8,
        strength: 1.2,
        seed: 12,
        colorA: '#242a31',
        colorB: '#707986',
        displacement: 0.018
      }),
      layer('preset-marble-vein', 'White veins', 'veins', {
        blendMode: 'screen',
        opacity: 0.72,
        scale: 5.7,
        strength: 1.7,
        seed: 23,
        colorA: '#59616b',
        colorB: '#eef2f5',
        roughness: -0.12,
        displacement: 0.004
      })
    ]
  },
  {
    id: 'molten-rock',
    name: 'Molten Rock',
    description: 'Cracked dark crust with hot procedural fissures.',
    physical: {
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.48,
      specularIntensity: 0.46,
      ior: 1.46
    },
    layers: [
      layer('preset-lava-base', 'Crust', 'base', {
        colorA: '#100d0c',
        colorB: '#2d2722',
        roughness: 0.4
      }),
      layer('preset-lava-rock', 'Rock breakup', 'cellular', {
        blendMode: 'overlay',
        opacity: 0.65,
        scale: 4.3,
        strength: 1.15,
        seed: 9,
        colorA: '#17120f',
        colorB: '#504034',
        displacement: 0.07
      }),
      layer('preset-lava-ridges', 'Molten cracks', 'veins', {
        blendMode: 'add',
        opacity: 0.9,
        scale: 6.8,
        strength: 1.5,
        seed: 27,
        colorA: '#7a1600',
        colorB: '#ff9b21',
        roughness: -0.28,
        displacement: -0.018
      })
    ]
  },
  {
    id: 'alien-dermis',
    name: 'Alien Dermis',
    description: 'Organic cool dermis with spots, ridges and subtle veins.',
    physical: {
      roughness: 0.36,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.16,
      specularIntensity: 0.7,
      ior: 1.4
    },
    layers: [
      layer('preset-alien-base', 'Dermis', 'base', {
        colorA: '#233a3b',
        colorB: '#547b73',
        roughness: 0.22
      }),
      layer('preset-alien-cells', 'Cells', 'cellular', {
        blendMode: 'overlay',
        opacity: 0.54,
        scale: 5.4,
        strength: 1.1,
        seed: 13,
        colorA: '#1d3033',
        colorB: '#83aa91',
        displacement: 0.038
      }),
      layer('preset-alien-spots', 'Pigment', 'spots', {
        blendMode: 'multiply',
        opacity: 0.5,
        scale: 8.5,
        strength: 1.25,
        seed: 29,
        colorA: '#172125',
        colorB: '#7a9c85'
      }),
      layer('preset-alien-veins', 'Veins', 'veins', {
        blendMode: 'screen',
        opacity: 0.34,
        scale: 10.0,
        strength: 1.4,
        seed: 41,
        colorA: '#304b54',
        colorB: '#8bc9bf',
        roughness: -0.08
      })
    ]
  }
];
