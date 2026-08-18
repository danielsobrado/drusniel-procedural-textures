import type { MeshPhysicalMaterial } from 'three';
import type { PhysicalSettings } from './types';

export function applyPhysicalSettings(
  material: MeshPhysicalMaterial,
  settings: Readonly<PhysicalSettings>
): void {
  material.roughness = settings.roughness;
  material.metalness = settings.metalness;
  material.clearcoat = settings.clearcoat;
  material.clearcoatRoughness = settings.clearcoatRoughness;
  material.specularIntensity = settings.specularIntensity;
  material.ior = settings.ior;
}
