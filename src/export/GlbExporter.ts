import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeletonSafe } from 'three/addons/utils/SkeletonUtils.js';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import {
  TextureBaker,
  type BakeMeshSnapshot,
  type BakedPbrTextureSet
} from './TextureBaker';

interface ExportResources {
  materials: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
}

interface ExportMeshSnapshot {
  assigned: boolean;
  bake: BakeMeshSnapshot | null;
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function sourceForExport(root: THREE.Object3D): THREE.Object3D {
  if (root.userData.labPreviewWrapper !== true) return root;
  const source = root.children[0];
  if (source === undefined) {
    throw new Error('Imported preview wrapper does not contain its source model.');
  }
  return source;
}

function synchronizeCloneUuids(source: THREE.Object3D, clone: THREE.Object3D): void {
  const sourceObjects: THREE.Object3D[] = [];
  const cloneObjects: THREE.Object3D[] = [];
  source.traverse((object) => sourceObjects.push(object));
  clone.traverse((object) => cloneObjects.push(object));
  if (sourceObjects.length !== cloneObjects.length) {
    throw new Error('Export clone does not match the current object hierarchy.');
  }
  for (let index = 0; index < sourceObjects.length; index += 1) {
    const sourceObject = sourceObjects[index];
    const cloneObject = cloneObjects[index];
    if (sourceObject !== undefined && cloneObject !== undefined) {
      cloneObject.uuid = sourceObject.uuid;
    }
  }
}

function cleanLabMetadata(root: THREE.Object3D): void {
  root.traverse((object) => {
    delete object.userData.labMeshId;
    delete object.userData.labMeshLabel;
    delete object.userData.labImportedSource;
    delete object.userData.labPreviewWrapper;
    delete object.userData.labPreviewScale;
    delete object.userData.labPreviewCenter;
    delete object.userData.labProceduralPreview;
    delete object.userData.labObjectPreset;
  });
}

function canvasTexture(
  canvas: HTMLCanvasElement,
  name: string,
  colorSpace: THREE.ColorSpace,
  resources: ExportResources
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  resources.textures.push(texture);
  return texture;
}

function createBakedMaterial(
  maps: BakedPbrTextureSet,
  settings: Readonly<PhysicalSettings>,
  index: number,
  resources: ExportResources
): THREE.MeshPhysicalMaterial {
  const prefix = `PTL export ${index + 1}`;
  const material = new THREE.MeshPhysicalMaterial({
    name: prefix,
    color: 0xffffff,
    map: canvasTexture(maps.albedo.canvas, `${prefix} albedo`, THREE.SRGBColorSpace, resources),
    roughness: 1,
    roughnessMap: canvasTexture(maps.roughness.canvas, `${prefix} roughness`, THREE.NoColorSpace, resources),
    metalness: settings.metalness,
    normalMap: canvasTexture(maps.normal.canvas, `${prefix} normal`, THREE.NoColorSpace, resources),
    clearcoat: 1,
    clearcoatMap: canvasTexture(maps.clearcoat.canvas, `${prefix} clearcoat`, THREE.NoColorSpace, resources),
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: canvasTexture(
      maps.clearcoatRoughness.canvas,
      `${prefix} clearcoat roughness`,
      THREE.NoColorSpace,
      resources
    ),
    specularIntensity: settings.specularIntensity,
    ior: settings.ior,
    sheen: settings.sheen,
    sheenRoughness: settings.sheenRoughness,
    sheenColor: settings.sheenColor,
    transmission: settings.transmission,
    thickness: settings.thickness,
    attenuationDistance: settings.attenuationDistance,
    attenuationColor: settings.attenuationColor
  });
  resources.materials.push(material);
  return material;
}

function copyImageBitmap(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Browser cannot snapshot an imported texture for GLB export.');
  }
  context.drawImage(image, 0, 0);
  return canvas;
}

function cloneTexture(texture: THREE.Texture, resources: ExportResources): THREE.Texture {
  const clone = texture.clone();
  if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
    clone.image = copyImageBitmap(texture.image);
  }
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

function cloneMaterialSet(
  material: THREE.Material | THREE.Material[],
  resources: ExportResources
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((item) => cloneMaterial(item, resources))
    : cloneMaterial(material, resources);
}

function snapshotOriginalMaterials(
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
      const materialOwner = object as THREE.Object3D & {
        material: THREE.Material | THREE.Material[];
      };
      materialOwner.material = cloneMaterialSet(materialOwner.material, resources);
    }
  });
}

function disposeResources(resources: ExportResources): void {
  resources.materials.forEach((material) => material.dispose());
  resources.textures.forEach((texture) => texture.dispose());
  resources.geometries.forEach((geometry) => geometry.dispose());
}

export class GlbExporter {
  public constructor(
    private readonly baker: TextureBaker,
    private readonly compiler: MaterialCompiler
  ) {}

  public async export(
    previewRoot: THREE.Object3D,
    settings: Readonly<PhysicalSettings>,
    bakeResolution: number,
    maxTextureSize: number
  ): Promise<Blob> {
    previewRoot.updateMatrixWorld(true);
    const sourceRoot = sourceForExport(previewRoot);
    const sourceMeshes = collectMeshes(sourceRoot);
    if (sourceMeshes.length === 0) throw new Error('There is no mesh geometry to export.');

    const physical = structuredClone(settings);
    const animations = sourceRoot.animations.map((clip) => clip.clone());
    const bakeMaterial = this.compiler.createBakeMaterial(physical);
    const meshSnapshots: ExportMeshSnapshot[] = [];
    try {
      for (const source of sourceMeshes) {
        const assigned = source.material === this.compiler.material;
        meshSnapshots.push({
          assigned,
          bake: assigned ? this.baker.snapshotMesh(source) : null
        });
      }
    } catch (error) {
      for (const snapshot of meshSnapshots) {
        if (snapshot.bake !== null) this.baker.disposeSnapshot(snapshot.bake);
      }
      bakeMaterial.dispose();
      throw error;
    }

    const exportRoot = cloneSkeletonSafe(sourceRoot);
    synchronizeCloneUuids(sourceRoot, exportRoot);
    const exportMeshes = collectMeshes(exportRoot);
    if (exportMeshes.length !== sourceMeshes.length) {
      for (const snapshot of meshSnapshots) {
        if (snapshot.bake !== null) this.baker.disposeSnapshot(snapshot.bake);
      }
      bakeMaterial.dispose();
      throw new Error('Export clone does not match the current mesh hierarchy.');
    }

    const resources: ExportResources = { materials: [], textures: [], geometries: [] };
    const assignedTargets = new Set<THREE.Mesh>();
    for (let index = 0; index < exportMeshes.length; index += 1) {
      if (meshSnapshots[index]?.assigned === true && exportMeshes[index] !== undefined) {
        assignedTargets.add(exportMeshes[index] as THREE.Mesh);
      }
    }
    snapshotOriginalMaterials(exportRoot, assignedTargets, resources);
    cleanLabMetadata(exportRoot);

    try {
      for (let index = 0; index < meshSnapshots.length; index += 1) {
        const snapshot = meshSnapshots[index];
        const target = exportMeshes[index];
        if (snapshot === undefined || target === undefined || !snapshot.assigned || snapshot.bake === null) continue;

        const maps = await this.baker.bakePbrSnapshot(
          snapshot.bake,
          physical,
          bakeResolution,
          bakeMaterial
        );
        if (snapshot.bake.generatedUvAtlas) {
          const geometry = snapshot.bake.geometry.clone();
          target.geometry = geometry;
          resources.geometries.push(geometry);
        }
        target.material = createBakedMaterial(maps, physical, index, resources);
        target.customDepthMaterial = undefined;
        target.customDistanceMaterial = undefined;
      }

      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(exportRoot, {
        binary: true,
        embedImages: true,
        onlyVisible: true,
        truncateDrawRange: true,
        forceIndices: true,
        includeCustomExtensions: false,
        maxTextureSize,
        animations
      });
      if (!(result instanceof ArrayBuffer)) {
        throw new Error('GLB exporter returned an unexpected non-binary result.');
      }
      return new Blob([result], { type: 'model/gltf-binary' });
    } finally {
      for (const snapshot of meshSnapshots) {
        if (snapshot.bake !== null) this.baker.disposeSnapshot(snapshot.bake);
      }
      bakeMaterial.dispose();
      disposeResources(resources);
    }
  }
}
