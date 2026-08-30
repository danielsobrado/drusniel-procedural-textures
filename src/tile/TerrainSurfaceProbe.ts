import * as THREE from 'three';
import { sampleTerrainHeight } from './TerrainPlayerController';
import {
  TERRAIN_MATERIALS,
  type TerrainBaseMaterialId,
  type TerrainFields,
  type TerrainMaterialId,
  type TerrainPaintMask
} from './TerrainTypes';

/** Paint slots at or above this weight win over the automatic classification. */
const OVERRIDE_WEIGHT = 0.5;
const NO_OVERRIDE = 255;

export interface TerrainMaterialHit {
  material: TerrainMaterialId;
  /** Automatic classification underneath any paint override; always assignable. */
  base: TerrainBaseMaterialId;
  overridden: boolean;
  riverStrength: number;
  heightMeters: number;
}

/** Field cell covering a world position, wrapped. Shared so callers cannot disagree. */
export function terrainFieldIndexAt(
  fields: Readonly<TerrainFields>,
  worldX: number,
  worldZ: number,
  terrainSize: number
): number {
  const resolution = fields.resolution;
  if (resolution <= 0) return 0;
  const u = THREE.MathUtils.euclideanModulo(worldX / terrainSize + 0.5, 1);
  const v = THREE.MathUtils.euclideanModulo(worldZ / terrainSize + 0.5, 1);
  const x = Math.min(resolution - 1, Math.floor(u * resolution));
  const y = Math.min(resolution - 1, Math.floor(v * resolution));
  return y * resolution + x;
}

function materialIdAt(index: number): TerrainMaterialId {
  return TERRAIN_MATERIALS[index]?.id ?? 'grass';
}

function baseIdAt(index: number): TerrainBaseMaterialId {
  const id = materialIdAt(index);
  return id === 'current' || id === 'custom' ? 'grass' : id;
}

/**
 * Which material sits at a world position, answered on the CPU.
 *
 * A raycast cannot answer this: the layers select themselves with an `alphaMap` on the GPU,
 * so the mask is the only authority. This applies the same override-beats-classification
 * rule as `buildTerrainMaterialMasks`, and uses the same wrap and orientation convention as
 * `sampleTerrainHeight`, so the picker, the HUD and the renderer cannot disagree.
 */
export function sampleTerrainMaterialAt(
  fields: Readonly<TerrainFields>,
  paint: Readonly<TerrainPaintMask>,
  worldX: number,
  worldZ: number,
  terrainSize: number,
  terrainHeight: number
): TerrainMaterialHit {
  const resolution = fields.resolution;
  const fallback: TerrainMaterialHit = {
    material: 'grass',
    base: 'grass',
    overridden: false,
    riverStrength: 0,
    heightMeters: 0
  };
  if (resolution <= 0) return fallback;

  const index = terrainFieldIndexAt(fields, worldX, worldZ, terrainSize);

  const base = baseIdAt(fields.material[index] ?? 0);
  const overrideIndex = paint.material[index] ?? NO_OVERRIDE;
  const weight = paint.weight[index] ?? 0;
  const overridden = overrideIndex !== NO_OVERRIDE && weight >= OVERRIDE_WEIGHT;

  return {
    material: overridden ? materialIdAt(overrideIndex) : base,
    base,
    overridden,
    riverStrength: fields.river[index] ?? 0,
    heightMeters: sampleTerrainHeight(fields, worldX, worldZ, terrainSize, terrainHeight)
  };
}

/**
 * First surface intersection along a ray, by marching the height field.
 *
 * Deliberately not a raycast: `Mesh.raycast` is brute force per triangle against nine meshes
 * of 128 squared segments, roughly 130k triangles, which is far too slow to run per frame for
 * a reticle read-out. Marching the field costs about 26 scalar samples.
 */
export function marchTerrainRay(
  fields: Readonly<TerrainFields>,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  terrainSize: number,
  terrainHeight: number,
  maxDistance: number,
  steps = 16,
  refinements = 6
): THREE.Vector3 | null {
  const step = maxDistance / steps;
  const probe = new THREE.Vector3();
  let previous = 0;
  let previousAbove = true;

  for (let index = 1; index <= steps; index += 1) {
    const distance = step * index;
    probe.copy(origin).addScaledVector(direction, distance);
    const ground = sampleTerrainHeight(fields, probe.x, probe.z, terrainSize, terrainHeight);
    const above = probe.y > ground;
    if (above) {
      previous = distance;
      previousAbove = true;
      continue;
    }
    if (!previousAbove) break;

    let near = previous;
    let far = distance;
    for (let refinement = 0; refinement < refinements; refinement += 1) {
      const middle = (near + far) * 0.5;
      probe.copy(origin).addScaledVector(direction, middle);
      const height = sampleTerrainHeight(fields, probe.x, probe.z, terrainSize, terrainHeight);
      if (probe.y > height) near = middle;
      else far = middle;
    }
    return probe.copy(origin).addScaledVector(direction, (near + far) * 0.5);
  }
  return null;
}
