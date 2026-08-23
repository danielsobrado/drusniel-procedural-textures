import type { Color } from 'three';
import type { PhysicalSettings } from './types';

const MIN_RUNTIME_CLEARCOAT = 0.0001;

interface PhysicalMaterialTarget {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
  ior: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: Color;
  transmission: number;
  thickness: number;
  attenuationDistance: number;
  attenuationColor: Color;
  opacity: number;
  needsUpdate: boolean;
}

export function applyPhysicalSettings(
  material: PhysicalMaterialTarget,
  settings: Readonly<PhysicalSettings>
): void {
  const hadTransmission = material.transmission > 0;
  const hadSheen = material.sheen > 0;
  const hasTransmission = settings.transmission > 0;
  const hasSheen = settings.sheen > 0;

  material.roughness = settings.roughness;
  material.metalness = settings.metalness;
  material.clearcoat = Math.max(settings.clearcoat, MIN_RUNTIME_CLEARCOAT);
  material.clearcoatRoughness = settings.clearcoatRoughness;
  material.specularIntensity = settings.specularIntensity;
  material.ior = settings.ior;
  material.sheen = settings.sheen;
  material.sheenRoughness = settings.sheenRoughness;
  material.sheenColor.set(settings.sheenColor);
  material.transmission = settings.transmission;
  material.thickness = settings.thickness;
  material.attenuationDistance = settings.attenuationDistance;
  material.attenuationColor.set(settings.attenuationColor);
  material.opacity = 1;

  if (hadTransmission !== hasTransmission || hadSheen !== hasSheen) {
    material.needsUpdate = true;
  }
}
