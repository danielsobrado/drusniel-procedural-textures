import type { TerrainFields, TerrainPaintMask } from './TerrainTypes';

export const TERRAIN_BASE_MATERIAL_COUNT = 4;
export const TERRAIN_MATERIAL_COUNT = 6;
const NO_MATERIAL = 255;

export interface TerrainMaterialMasks {
  base: readonly Uint8Array[];
  override: readonly Uint8Array[];
}

/**
 * Builds GPU-ready scalar masks without baking material pixels into the terrain map.
 * Base classification stays opaque; manual paint is a separate soft overlay.
 */
export function buildTerrainMaterialMasks(
  fields: Readonly<TerrainFields>,
  paint: Readonly<TerrainPaintMask>
): TerrainMaterialMasks {
  const pixelCount = fields.resolution * fields.resolution;
  if (fields.material.length !== pixelCount ||
      paint.material.length !== pixelCount ||
      paint.weight.length !== pixelCount) {
    throw new Error('Terrain material masks must match the terrain field resolution.');
  }

  const base = Array.from(
    { length: TERRAIN_BASE_MATERIAL_COUNT },
    () => new Uint8Array(pixelCount)
  );
  const override = Array.from(
    { length: TERRAIN_MATERIAL_COUNT },
    () => new Uint8Array(pixelCount)
  );

  for (let index = 0; index < pixelCount; index += 1) {
    const baseIndex = fields.material[index] ?? 0;
    if (baseIndex < TERRAIN_BASE_MATERIAL_COUNT) base[baseIndex]![index] = 255;

    const overrideIndex = paint.material[index] ?? NO_MATERIAL;
    if (overrideIndex >= TERRAIN_MATERIAL_COUNT) continue;
    const weight = Math.max(0, Math.min(1, paint.weight[index] ?? 0));
    override[overrideIndex]![index] = Math.round(weight * 255);
  }
  return { base, override };
}
