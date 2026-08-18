import * as THREE from 'three';

export function collectObjectMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const sourceMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    sourceMaterials.forEach((material) => materials.add(material));
  });

  return materials;
}

export function disposeObjectGeometries(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
}

export function disposeMaterialResources(materials: Iterable<THREE.Material>): void {
  const textures = new Set<THREE.Texture>();

  for (const material of materials) {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    }
    material.dispose();
  }

  for (const texture of textures) {
    const image = texture.image as unknown;
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      image.close();
    }
  }
}

export function disposeObjectResources(root: THREE.Object3D): void {
  const materials = collectObjectMaterials(root);
  disposeObjectGeometries(root);
  disposeMaterialResources(materials);
}
