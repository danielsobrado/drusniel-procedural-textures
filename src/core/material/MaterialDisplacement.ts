import { RUNTIME_GRASS_PATTERN_CONFIG } from './generated/runtimeConfig';
import type { MaterialGroup, MaterialLayer } from './RuntimeMaterial';
import { PTL_CELLULAR_DEFAULTS } from './runtimeDefaults';

function effectiveGroupOpacity(
  groupId: string | null,
  groups: ReadonlyMap<string, Readonly<MaterialGroup>>
): number {
  let opacity = 1;
  let currentId = groupId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (visited.has(currentId)) return 0;
    visited.add(currentId);
    const group = groups.get(currentId);
    if (group === undefined || !group.enabled) return 0;
    opacity *= group.opacity;
    currentId = group.parentId;
  }
  return opacity;
}

function signalExtent(layer: Readonly<MaterialLayer>): number {
  if (layer.kind === 'base') return layer.texture === null || layer.texture === undefined ? 0 : 0.5;
  if (layer.kind === 'pattern') {
    if (layer.pattern?.kind === 'grass') {
      return RUNTIME_GRASS_PATTERN_CONFIG.rendering.geometryDisplacementGain;
    }
    if (layer.pattern?.kind === 'turf') {
      return RUNTIME_GRASS_PATTERN_CONFIG.rendering.turfGeometryDisplacementGain;
    }
  }
  if (layer.kind === 'spots' || layer.kind === 'veins' || layer.kind === 'vessels' || layer.kind === 'pattern') return 1;
  if (layer.kind === 'cellular') return PTL_CELLULAR_DEFAULTS.displacement.gain * 0.5;
  return 0.5;
}

export function materialDisplacementExtent(
  layers: readonly MaterialLayer[],
  groups: readonly MaterialGroup[]
): number {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return layers.reduce((extent, layer) => {
    if (
      !layer.enabled || (layer.channel !== 'surface' && layer.channel !== 'height') ||
      Math.abs(layer.displacement) <= 1e-8 || layer.opacity <= 0
    ) return extent;
    const groupOpacity = effectiveGroupOpacity(layer.groupId, groupsById);
    return extent + Math.abs(layer.displacement) * layer.opacity * groupOpacity * signalExtent(layer);
  }, 0);
}
