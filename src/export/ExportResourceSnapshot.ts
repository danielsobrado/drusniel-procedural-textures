import * as THREE from 'three';

export interface ExportResources {
  materials: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
}

function copyImageBitmap(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Browser cannot snapshot an imported texture for GLB export.');
  context.drawImage(image, 0, 0);
  return canvas;
}

function cloneTexture(texture: THREE.Texture, resources: ExportResources): THREE.Texture {
  const clone = texture.clone();
  if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) clone.image = copyImageBitmap(texture.image);
  clone.needsUpdate = true;
  resources.textures.push(clone);
  return clone;
}

function cloneMaterial(material: THREE.Material, resources: ExportResources): THREE.Material {
  const clone = material.clone();
  const sourceValues = material as unknown as Record<string, unknown>;
  const cloneValues = clone as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(sourceValues)) {
    if (value instanceof THREE.Texture) cloneValues[key] = cloneTexture(value, resources);
  }
  resources.materials.push(clone);
  return clone;
}

export function cloneMaterialSet(
  material: THREE.Material | THREE.Material[],
  resources: ExportResources
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => cloneMaterial(item, resources))
    : cloneMaterial(material, resources);
}

export function snapshotOriginalMaterials(
  root: THREE.Object3D,
  assignedMeshes: ReadonlySet<THREE.Mesh>,
  resources: ExportResources
): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      if (!assignedMeshes.has(object)) object.material = cloneMaterialSet(object.material, resources);
      return;
    }
    if (object instanceof THREE.Line || object instanceof THREE.Points) {
      const owner = object as THREE.Object3D & { material: THREE.Material | THREE.Material[] };
      owner.material = cloneMaterialSet(owner.material, resources);
    }
  });
}

export function disposeExportResources(resources: ExportResources): void {
  resources.materials.forEach((material) => material.dispose());
  resources.textures.forEach((texture) => texture.dispose());
  resources.geometries.forEach((geometry) => geometry.dispose());
}
