import type { LayerKind, MaterialLayer } from './types';
import {
  PTL_DEFAULT_MASK_BREAKUP,
  PTL_DEFAULT_MASK_SOFTNESS,
  PTL_DEFAULT_MASK_THRESHOLD
} from '../core/material/runtimeDefaults';

function defaultChannel(kind: LayerKind): MaterialLayer['channel'] {
  if (kind === 'wet-film') return 'clearcoat';
  if (kind === 'sss') return 'sss';
  if (kind === 'vessels') return 'color';
  return 'surface';
}

export function createPresetLayer(
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
    channel: defaultChannel(kind),
    opacity: 1,
    scale: 3,
    strength: 1,
    seed: 1,
    colorA: '#545862',
    colorB: '#d8dce6',
    roughness: 0,
    displacement: 0,
    groupId: null,
    maskSourceLayerId: null,
    structureSourceLayerId: null,
    maskInvert: false,
    maskStrength: 1,
    maskMode: 'coverage',
    maskThreshold: PTL_DEFAULT_MASK_THRESHOLD,
    maskSoftness: PTL_DEFAULT_MASK_SOFTNESS,
    maskBreakup: PTL_DEFAULT_MASK_BREAKUP,
    ...overrides
  };
}
