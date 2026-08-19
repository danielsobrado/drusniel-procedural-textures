import * as THREE from 'three';

type GeometryRenderable = THREE.Mesh | THREE.Line | THREE.Points;

function isGeometryRenderable(object: THREE.Object3D): object is GeometryRenderable {
  return object instanceof THREE.Mesh ||
    object instanceof THREE.Line ||
    object instanceof THREE.Points;
}

function addMaterials(
  materials: Set<THREE.Material>,
  material: THREE.Material | THREE.Material[]
): void {
  const values = Array.isArray(material) ? material : [material];
  values.forEach((value) => materials.add(value));
}

export function collectObjectMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (isGeometryRenderable(object)) {
      addMaterials(materials, object.material);
    }
  });

  return materials;
}

export function collectMeshMaterials(root: THREE.Object3D): Set<THREE.Material> {
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      addMaterials(materials, object.material);
    }
  });

  return materials;
}

export function disposeObjectGeometries(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();

  root.traverse((object) => {
    if (isGeometryRenderable(object)) {
      geometries.add(object.geometry);
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
}

export function disposeObjectSkeletons(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>();

  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) {
      skeletons.add(object.skeleton);
    }
  });

  skeletons.forEach((skeleton) => skeleton.dispose());
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

export function disposeObjectResources(
  root: THREE.Object3D,
  preservedMaterials: ReadonlySet<THREE.Material> = new Set()
): void {
  const materials = collectObjectMaterials(root);
  for (const material of preservedMaterials) {
    materials.delete(material);
  }

  disposeObjectGeometries(root);
  disposeObjectSkeletons(root);
  disposeMaterialResources(materials);
}
