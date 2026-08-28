import { PTL_MAX_LAYERS } from './runtimeDefaults';
import type { MaterialLayer } from './RuntimeMaterial';

export function requiredMaterialFieldLayerIndices(
  layers: readonly MaterialLayer[]
): ReadonlySet<number> {
  const activeLayers = layers.slice(0, PTL_MAX_LAYERS);
  const indexById = new Map(activeLayers.map((layer, index) => [layer.id, index]));
  const required = new Set<number>();
  const queue: number[] = [];

  activeLayers.forEach((layer, index) => {
    if (!layer.enabled) return;
    required.add(index);
    queue.push(index);
  });

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (index === undefined) continue;
    const layer = activeLayers[index];
    if (layer === undefined) continue;

    for (const sourceId of [layer.maskSourceLayerId, layer.structureSourceLayerId]) {
      if (sourceId === null) continue;
      const sourceIndex = indexById.get(sourceId);
      if (sourceIndex === undefined || required.has(sourceIndex)) continue;
      required.add(sourceIndex);
      queue.push(sourceIndex);
    }
  }

  return required;
}

export function requiredTextureFieldIds(layers: readonly MaterialLayer[]): string[] {
  const required = requiredMaterialFieldLayerIndices(layers);
  return [...new Set(layers
    .slice(0, PTL_MAX_LAYERS)
    .flatMap((layer, index) => {
      if (!required.has(index) || layer.texture === null || layer.texture === undefined) return [];
      return [layer.texture.id];
    }))]
    .sort((left, right) => left.localeCompare(right));
}
