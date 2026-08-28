import {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  type TextureFieldSettings
} from '../core/texture/TextureFieldSettings';
import { createPresetLayer as layer } from './presetLayer';
import type { MaterialLayer, MaterialPreset } from './types';

interface HybridPresetEnhancement {
  layers: Readonly<Record<string, Partial<MaterialLayer>>>;
  appendLayers?: readonly MaterialLayer[];
}

const TEXTURES = {
  cracks02: 'cracks.02',
  cracks03: 'cracks.03',
  craters03: 'craters.03',
  craters04: 'craters.04',
  crystal01: 'crystal.01',
  grainy03: 'grainy.03',
  grainy04: 'grainy.04',
  grainy05: 'grainy.05',
  grainy06: 'grainy.06',
  manifold02: 'manifold.02',
  manifold03: 'manifold.03',
  manifold05: 'manifold.05',
  manifold06: 'manifold.06',
  manifold08: 'manifold.08',
  marble06: 'marble.06',
  milky01: 'milky.01',
  milky02: 'milky.02',
  milky03: 'milky.03',
  milky04: 'milky.04',
  milky05: 'milky.05',
  organic02: 'organic.02',
  rock01: 'rock.01',
  stone01: 'stone.01',
  stone04: 'stone.04',
  streak02: 'streak.02',
  streak03: 'streak.03',
  streak06: 'streak.06',
  superNoise01: 'super-noise.01',
  superNoise02: 'super-noise.02',
  superNoise03: 'super-noise.03',
  superNoise06: 'super-noise.06',
  superPerlin06: 'super-perlin.06',
  vein01: 'vein.01',
  vein03: 'vein.03'
} as const;

function textureField(
  id: string,
  overrides: Partial<TextureFieldSettings> = {}
): TextureFieldSettings {
  return {
    ...DEFAULT_TEXTURE_FIELD_SETTINGS,
    mode: 'modulate',
    id,
    ...overrides
  };
}

const ENHANCEMENTS: Readonly<Record<string, HybridPresetEnhancement>> = {
  'forest-loam': {
    layers: {
      'preset-forest-loam-humus': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.16, scaleY: 0.84, rotation: 0.34,
          offsetX: 0.21, offsetY: 0.47, contrast: 1.12, bias: -0.03
        })
      }
    },
    appendLayers: [
      layer('preset-forest-loam-micro-roughness', 'Organic soil micro roughness', 'fbm', {
        channel: 'roughness', opacity: 0.24, scale: 17.6, strength: 1.04, seed: 88,
        roughness: 0.14,
        texture: textureField(TEXTURES.grainy04, {
          mode: 'detail', modeAmount: 0.35,
          scaleX: 1.31, scaleY: 0.91, rotation: -0.37,
          offsetX: 0.48, offsetY: 0.14, contrast: 1.04, bias: 0.01
        })
      })
    ]
  },
  'red-clay-ground': {
    layers: {
      'preset-red-clay-moisture': {
        texture: textureField(TEXTURES.streak03, {
          scaleX: 1.28, scaleY: 0.72, rotation: 0.22,
          offsetX: 0.39, offsetY: 0.18, contrast: 1.08, bias: -0.04
        })
      },
      'preset-red-clay-breakup': {
        texture: textureField(TEXTURES.grainy03, {
          scaleX: 1.42, scaleY: 0.88, rotation: -0.49,
          offsetX: 0.16, offsetY: 0.57, contrast: 1.1, bias: -0.02
        })
      }
    }
  },
  'alpine-scree': {
    layers: {
      'preset-alpine-scree-weathering': {
        texture: textureField(TEXTURES.rock01, {
          scaleX: 1.19, scaleY: 0.83, rotation: 0.31,
          offsetX: 0.44, offsetY: 0.12, contrast: 1.16, bias: -0.03
        })
      }
    },
    appendLayers: [
      layer('preset-alpine-scree-micro-roughness', 'Rock micro roughness', 'fbm', {
        channel: 'roughness', opacity: 0.26, scale: 17.8, strength: 1.06, seed: 93,
        roughness: 0.14,
        texture: textureField(TEXTURES.grainy06, {
          mode: 'detail', modeAmount: 0.35,
          scaleX: 1.36, scaleY: 0.94, rotation: -0.43,
          offsetX: 0.22, offsetY: 0.61, contrast: 0.98, bias: 0.02
        })
      })
    ]
  },
  'coastal-sand': {
    layers: {
      'preset-coastal-sand-swells': {
        texture: textureField(TEXTURES.superPerlin06, {
          scaleX: 1.22, scaleY: 0.79, rotation: 0.18,
          offsetX: 0.36, offsetY: 0.52, contrast: 0.94, bias: -0.01
        })
      },
      'preset-coastal-sand-grain': {
        texture: textureField(TEXTURES.grainy03, {
          scaleX: 1.48, scaleY: 0.86, rotation: -0.36,
          offsetX: 0.14, offsetY: 0.67, contrast: 1.06, bias: 0
        })
      }
    }
  },
  'volcanic-soil': {
    layers: {
      'preset-volcanic-soil-ash': {
        texture: textureField(TEXTURES.superNoise01, {
          scaleX: 1.13, scaleY: 0.89, rotation: 0.28,
          offsetX: 0.46, offsetY: 0.21, contrast: 1.16, bias: -0.035
        })
      },
      'preset-volcanic-soil-breakup': {
        texture: textureField(TEXTURES.craters03, {
          scaleX: 1.34, scaleY: 0.92, rotation: -0.44,
          offsetX: 0.18, offsetY: 0.58, contrast: 1.28, bias: -0.06
        })
      }
    },
    appendLayers: [
      layer('preset-volcanic-soil-micro-cracks', 'Irregular cooling microcracks', 'veins', {
        channel: 'height', opacity: 0.09, scale: 9.4, strength: 1.18, seed: 91,
        displacement: -0.008,
        texture: textureField(TEXTURES.cracks03, {
          scaleX: 1.08, scaleY: 1.21, rotation: 0.62,
          offsetX: 0.31, offsetY: 0.09, contrast: 1.38, bias: -0.07
        })
      })
    ]
  },
  'riverbank-mud': {
    layers: {
      'preset-riverbank-mud-moisture': {
        texture: textureField(TEXTURES.streak06, {
          scaleX: 1.31, scaleY: 0.74, rotation: -0.19,
          offsetX: 0.42, offsetY: 0.24, contrast: 1.02, bias: -0.03
        })
      },
      'preset-riverbank-mud-grit': {
        texture: textureField(TEXTURES.grainy05, {
          scaleX: 1.37, scaleY: 0.9, rotation: 0.47,
          offsetX: 0.17, offsetY: 0.63, contrast: 1.12, bias: -0.02
        })
      }
    }
  },
  'limestone-gravel': {
    layers: {
      'preset-limestone-gravel-chalk': {
        texture: textureField(TEXTURES.stone01, {
          scaleX: 1.17, scaleY: 0.86, rotation: 0.29,
          offsetX: 0.43, offsetY: 0.16, contrast: 1.08, bias: 0.01
        })
      },
      'preset-limestone-gravel-breakup': {
        texture: textureField(TEXTURES.grainy06, {
          scaleX: 1.44, scaleY: 0.9, rotation: -0.41,
          offsetX: 0.19, offsetY: 0.59, contrast: 1.02, bias: 0.01
        })
      }
    }
  },
  'forest-moss-carpet': {
    layers: {
      'preset-forest-moss-patches': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.18, scaleY: 0.82, rotation: 0.37,
          offsetX: 0.25, offsetY: 0.49, contrast: 1.14, bias: -0.025
        })
      },
      'preset-forest-moss-cushions': {
        maskSourceLayerId: 'preset-forest-moss-patches',
        maskStrength: 0.28
      },
      'preset-forest-moss-breakup': {
        texture: textureField(TEXTURES.superNoise02, {
          scaleX: 1.39, scaleY: 0.9, rotation: -0.46,
          offsetX: 0.14, offsetY: 0.62, contrast: 1.08, bias: -0.01
        })
      }
    }
  },
  'mossy-stone': {
    layers: {
      'preset-mossy-stone-colonies': {
        maskSourceLayerId: 'preset-mossy-stone-meso',
        maskStrength: 0.24
      }
    },
    appendLayers: [
      layer('preset-mossy-stone-meso', 'Natural stone meso breakup', 'fbm', {
        blendMode: 'overlay', opacity: 0.18, scale: 5.8, strength: 1.08, seed: 83,
        colorA: '#2d3432', colorB: '#747b70', roughness: 0.04, displacement: 0.008,
        texture: textureField(TEXTURES.stone04, {
          scaleX: 1.21, scaleY: 0.84, rotation: 0.33,
          offsetX: 0.38, offsetY: 0.17, contrast: 1.16, bias: -0.025
        })
      })
    ]
  },
  'cushion-moss': {
    layers: {
      'preset-cushion-moss-leaves': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.27, scaleY: 0.85, rotation: -0.32,
          offsetX: 0.34, offsetY: 0.58, contrast: 1.18, bias: -0.03
        })
      }
    }
  },
  'crustose-lichen': {
    layers: {
      'preset-lichen-rock': {
        texture: textureField(TEXTURES.stone04, {
          scaleX: 1.19, scaleY: 0.86, rotation: 0.27,
          offsetX: 0.41, offsetY: 0.13, contrast: 1.12, bias: -0.02
        })
      },
      'preset-lichen-colonies': {
        maskSourceLayerId: 'preset-lichen-rock',
        maskStrength: 0.24
      },
      'preset-lichen-breakup': {
        texture: textureField(TEXTURES.manifold06, {
          scaleX: 1.33, scaleY: 0.91, rotation: -0.52,
          offsetX: 0.18, offsetY: 0.64, contrast: 1.12, bias: -0.025
        })
      }
    }
  },
  'bog-moss': {
    layers: {
      'preset-bog-moss-growth': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.16, scaleY: 0.84, rotation: 0.36,
          offsetX: 0.29, offsetY: 0.51, contrast: 1.1, bias: -0.02
        })
      },
      'preset-bog-moss-water': {
        texture: textureField(TEXTURES.manifold02, {
          scaleX: 1.24, scaleY: 0.8, rotation: -0.23,
          offsetX: 0.47, offsetY: 0.16, contrast: 1.06, bias: -0.04
        })
      }
    }
  },
  'sheet-moss': {
    layers: {
      'preset-sheet-moss-growth': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.2, scaleY: 0.83, rotation: 0.31,
          offsetX: 0.23, offsetY: 0.53, contrast: 1.12, bias: -0.02
        })
      }
    }
  },
  'reindeer-lichen': {
    layers: {
      'preset-reindeer-lichen-mineral': {
        texture: textureField(TEXTURES.manifold05, {
          scaleX: 1.28, scaleY: 0.87, rotation: -0.44,
          offsetX: 0.16, offsetY: 0.62, contrast: 1.1, bias: -0.025
        })
      }
    }
  },
  'glacial-cell-ice': {
    layers: {
      'preset-ice-glacial-micro': {
        texture: textureField(TEXTURES.superNoise02, {
          scaleX: 1.31, scaleY: 0.92, rotation: -0.39,
          offsetX: 0.21, offsetY: 0.57, contrast: 0.94, bias: 0.02
        })
      }
    },
    appendLayers: [
      layer('preset-ice-glacial-crystal-grain', 'Internal crystal grain', 'fbm', {
        blendMode: 'overlay', channel: 'color', opacity: 0.1, scale: 6.6,
        strength: 1.08, seed: 82, colorA: '#315e73', colorB: '#c7edf1',
        roughness: -0.02,
        texture: textureField(TEXTURES.crystal01, {
          scaleX: 1.14, scaleY: 0.88, rotation: 0.42,
          offsetX: 0.33, offsetY: 0.11, contrast: 1.16, bias: -0.02
        })
      }),
      layer('preset-ice-glacial-micro-fractures', 'Internal ice fractures', 'veins', {
        channel: 'height', opacity: 0.07, scale: 7.8, strength: 1.22, seed: 88,
        displacement: -0.009,
        maskSourceLayerId: 'preset-ice-glacial-cells', maskStrength: 0.32,
        texture: textureField(TEXTURES.cracks02, {
          scaleX: 1.06, scaleY: 1.22, rotation: 0.67,
          offsetX: 0.41, offsetY: 0.08, contrast: 1.4, bias: -0.075
        })
      }),
      layer('preset-ice-glacial-inclusions', 'Milky frozen inclusions', 'sss', {
        channel: 'sss', opacity: 0.14, scale: 3.4, strength: 1.1, seed: 94,
        colorA: '#4f8799', colorB: '#e4f7f7',
        texture: textureField(TEXTURES.milky02, {
          scaleX: 1.19, scaleY: 0.84, rotation: -0.28,
          offsetX: 0.17, offsetY: 0.48, contrast: 1.08, bias: -0.015
        })
      })
    ]
  },
  'lobular-adipose': {
    layers: {
      'preset-bio-lobular-stroma': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.18, scaleY: 0.84, rotation: 0.33,
          offsetX: 0.24, offsetY: 0.51, contrast: 1.08, bias: -0.02
        })
      },
      'preset-bio-lobular-capillary': {
        texture: textureField(TEXTURES.vein01, {
          scaleX: 1.11, scaleY: 0.92, rotation: -0.44,
          offsetX: 0.43, offsetY: 0.16, contrast: 1.24, bias: -0.06
        })
      },
      'preset-bio-lobular-vessels': {
        maskSourceLayerId: 'preset-bio-lobular-stroma',
        maskStrength: 0.18
      },
      'preset-bio-lobular-sss': {
        texture: textureField(TEXTURES.milky01, {
          scaleX: 1.2, scaleY: 0.86, rotation: 0.21,
          offsetX: 0.18, offsetY: 0.44, contrast: 0.98, bias: 0.01
        })
      }
    }
  },
  'vascular-adipose': {
    layers: {
      'preset-bio-vascular-perfusion': {
        texture: textureField(TEXTURES.manifold03, {
          scaleX: 1.17, scaleY: 0.82, rotation: 0.38,
          offsetX: 0.31, offsetY: 0.55, contrast: 1.12, bias: -0.025
        })
      },
      'preset-bio-vascular-pools': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.28, scaleY: 0.88, rotation: -0.31,
          offsetX: 0.42, offsetY: 0.14, contrast: 1.16, bias: -0.04
        })
      },
      'preset-bio-vascular-vessels': {
        maskSourceLayerId: 'preset-bio-vascular-perfusion',
        maskStrength: 0.22
      },
      'preset-bio-vascular-sss': {
        texture: textureField(TEXTURES.milky02, {
          scaleX: 1.19, scaleY: 0.85, rotation: 0.26,
          offsetX: 0.17, offsetY: 0.49, contrast: 1.02, bias: 0
        })
      }
    }
  },
  'yellow-adipose': {
    layers: {
      'preset-bio-yellow-marbled': {
        texture: textureField(TEXTURES.marble06, {
          scaleX: 1.26, scaleY: 0.8, rotation: -0.34,
          offsetX: 0.38, offsetY: 0.17, contrast: 1.12, bias: -0.02
        })
      },
      'preset-bio-yellow-sss': {
        texture: textureField(TEXTURES.milky03, {
          scaleX: 1.15, scaleY: 0.88, rotation: 0.24,
          offsetX: 0.15, offsetY: 0.46, contrast: 0.98, bias: 0.01
        })
      },
      'preset-bio-yellow-micro': {
        texture: textureField(TEXTURES.superNoise03, {
          scaleX: 1.37, scaleY: 0.9, rotation: -0.47,
          offsetX: 0.22, offsetY: 0.61, contrast: 1.04, bias: -0.01
        })
      }
    }
  },
  'fibrotic-fascia': {
    layers: {
      'preset-bio-fascia-density': {
        texture: textureField(TEXTURES.manifold06, {
          scaleX: 1.3, scaleY: 0.78, rotation: 0.43,
          offsetX: 0.36, offsetY: 0.12, contrast: 1.18, bias: -0.035
        })
      },
      'preset-bio-fascia-sss': {
        texture: textureField(TEXTURES.milky04, {
          scaleX: 1.18, scaleY: 0.86, rotation: -0.22,
          offsetX: 0.19, offsetY: 0.51, contrast: 1.04, bias: 0
        })
      }
    }
  },
  'granulation-tissue': {
    layers: {
      'preset-bio-granulation-edema': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.18, scaleY: 0.83, rotation: 0.35,
          offsetX: 0.27, offsetY: 0.53, contrast: 1.12, bias: -0.025
        })
      },
      'preset-bio-granulation-capillaries': {
        texture: textureField(TEXTURES.vein03, {
          scaleX: 1.09, scaleY: 0.94, rotation: -0.39,
          offsetX: 0.41, offsetY: 0.13, contrast: 1.28, bias: -0.065
        })
      },
      'preset-bio-granulation-vessels': {
        maskSourceLayerId: 'preset-bio-granulation-edema',
        maskStrength: 0.18
      },
      'preset-bio-granulation-sss': {
        texture: textureField(TEXTURES.milky05, {
          scaleX: 1.2, scaleY: 0.84, rotation: 0.23,
          offsetX: 0.16, offsetY: 0.48, contrast: 1.04, bias: 0
        })
      }
    }
  },
  'necrotic-adipose': {
    layers: {
      'preset-bio-necrotic-mottle': {
        texture: textureField(TEXTURES.manifold08, {
          scaleX: 1.22, scaleY: 0.81, rotation: 0.41,
          offsetX: 0.34, offsetY: 0.16, contrast: 1.2, bias: -0.04
        })
      },
      'preset-bio-necrotic-breakdown': {
        texture: textureField(TEXTURES.craters04, {
          scaleX: 1.16, scaleY: 0.9, rotation: -0.33,
          offsetX: 0.45, offsetY: 0.12, contrast: 1.3, bias: -0.07
        })
      },
      'preset-bio-necrotic-sss': {
        texture: textureField(TEXTURES.milky03, {
          scaleX: 1.18, scaleY: 0.86, rotation: 0.27,
          offsetX: 0.18, offsetY: 0.51, contrast: 0.96, bias: 0.01
        })
      },
      'preset-bio-necrotic-micro': {
        texture: textureField(TEXTURES.superNoise06, {
          scaleX: 1.39, scaleY: 0.91, rotation: -0.46,
          offsetX: 0.21, offsetY: 0.63, contrast: 1.06, bias: -0.015
        })
      }
    }
  },
  'lush-turf': {
    layers: {
      'preset-lush-turf-base': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.19, scaleY: 0.83, rotation: 0.32,
          offsetX: 0.26, offsetY: 0.52, contrast: 1.08, bias: -0.025
        })
      },
      'preset-lush-turf-fibers': {
        maskSourceLayerId: 'preset-lush-turf-base',
        maskStrength: 0.16
      }
    }
  },
  'wild-meadow-grass': {
    layers: {
      'preset-meadow-grass-base': {
        texture: textureField(TEXTURES.grainy03, {
          scaleX: 1.26, scaleY: 0.88, rotation: -0.28,
          offsetX: 0.39, offsetY: 0.15, contrast: 1.02, bias: -0.01
        })
      },
      'preset-meadow-grass-turf': {
        maskSourceLayerId: 'preset-meadow-grass-base',
        maskStrength: 0.18
      }
    }
  },
  'dry-savanna-grass': {
    layers: {
      'preset-savanna-grass-base': {
        texture: textureField(TEXTURES.grainy04, {
          scaleX: 1.31, scaleY: 0.86, rotation: 0.37,
          offsetX: 0.17, offsetY: 0.56, contrast: 1.06, bias: -0.02
        })
      },
      'preset-savanna-grass-mat': {
        maskSourceLayerId: 'preset-savanna-grass-base',
        maskStrength: 0.18
      }
    }
  },
  'coastal-dune-grass': {
    layers: {
      'preset-dune-grass-base': {
        texture: textureField(TEXTURES.streak02, {
          scaleX: 1.34, scaleY: 0.7, rotation: 0.16,
          offsetX: 0.42, offsetY: 0.18, contrast: 1.04, bias: -0.02
        })
      },
      'preset-dune-grass-turf': {
        maskSourceLayerId: 'preset-dune-grass-base',
        maskStrength: 0.2
      }
    }
  },
  'forest-understory-grass': {
    layers: {
      'preset-understory-grass-base': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.2, scaleY: 0.82, rotation: -0.3,
          offsetX: 0.29, offsetY: 0.54, contrast: 1.1, bias: -0.03
        })
      },
      'preset-understory-grass-turf': {
        maskSourceLayerId: 'preset-understory-grass-base',
        maskStrength: 0.2
      },
      'preset-understory-grass-damp': {
        texture: textureField(TEXTURES.manifold02, {
          scaleX: 1.25, scaleY: 0.79, rotation: 0.24,
          offsetX: 0.46, offsetY: 0.17, contrast: 1.08, bias: -0.04
        })
      }
    }
  },
  'wetland-sedge': {
    layers: {
      'preset-wetland-sedge-base': {
        texture: textureField(TEXTURES.organic02, {
          scaleX: 1.18, scaleY: 0.82, rotation: 0.34,
          offsetX: 0.28, offsetY: 0.51, contrast: 1.08, bias: -0.03
        })
      },
      'preset-wetland-sedge-blades': {
        maskSourceLayerId: 'preset-wetland-sedge-base',
        maskStrength: 0.18
      },
      'preset-wetland-sedge-water': {
        texture: textureField(TEXTURES.streak06, {
          scaleX: 1.29, scaleY: 0.76, rotation: -0.21,
          offsetX: 0.43, offsetY: 0.19, contrast: 1.04, bias: -0.035
        })
      }
    }
  },
  'frosted-grass': {
    layers: {
      'preset-frosted-grass-base': {
        texture: textureField(TEXTURES.superNoise03, {
          scaleX: 1.24, scaleY: 0.87, rotation: -0.36,
          offsetX: 0.22, offsetY: 0.58, contrast: 1.02, bias: -0.01
        })
      },
      'preset-frosted-grass-turf': {
        maskSourceLayerId: 'preset-frosted-grass-base',
        maskStrength: 0.16
      },
      'preset-frosted-grass-crystals': {
        maskSourceLayerId: 'preset-frosted-grass-base',
        maskStrength: 0.2
      }
    }
  }
};

export const HYBRID_TARGET_PRESET_IDS = Object.freeze(Object.keys(ENHANCEMENTS));

function cloneLayer(source: Readonly<MaterialLayer>): MaterialLayer {
  return {
    ...source,
    pattern: source.pattern === undefined || source.pattern === null
      ? source.pattern
      : { ...source.pattern },
    texture: source.texture === undefined || source.texture === null
      ? source.texture
      : { ...source.texture }
  };
}

export function applyHybridPresetEnhancements(preset: MaterialPreset): MaterialPreset {
  const enhancement = ENHANCEMENTS[preset.id];
  if (enhancement === undefined) return preset;

  const sourceIds = new Set(preset.layers.map((item) => item.id));
  for (const layerId of Object.keys(enhancement.layers)) {
    if (!sourceIds.has(layerId)) {
      throw new Error(`Hybrid preset ${preset.id} references missing layer ${layerId}.`);
    }
  }

  const layers = preset.layers.map((source) => {
    const patch = enhancement.layers[source.id];
    if (patch === undefined) return cloneLayer(source);
    const next = { ...cloneLayer(source), ...patch };
    if (patch.pattern !== undefined && patch.pattern !== null) next.pattern = { ...patch.pattern };
    if (patch.texture !== undefined && patch.texture !== null) next.texture = { ...patch.texture };
    return next;
  });

  const ids = new Set(layers.map((item) => item.id));
  for (const appended of enhancement.appendLayers ?? []) {
    if (ids.has(appended.id)) throw new Error(`Hybrid preset ${preset.id} duplicates layer ${appended.id}.`);
    layers.push(cloneLayer(appended));
    ids.add(appended.id);
  }

  return {
    ...preset,
    tags: [...new Set([...preset.tags, 'hybrid'])],
    layers
  };
}
