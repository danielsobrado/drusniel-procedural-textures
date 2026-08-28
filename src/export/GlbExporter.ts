import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeletonSafe } from 'three/addons/utils/SkeletonUtils.js';
import { EXPORT_CONFIG } from '../app/constants';
import { DEFAULT_MICRO_GEOMETRY } from '../config/surfaceDesignerConfig';
import type { MicroGeometrySettings } from '../core/material/MicroGeometry';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import {
  disposeExportResources,
  snapshotOriginalMaterials,
  type ExportResources
} from './ExportResourceSnapshot';
import {
  TextureBaker,
  type BakeMeshSnapshot,
  type BakedPbrTextureSet,
  type BakedTextureSet
} from './TextureBaker';
import {
  applyStaticDisplacement,
  combinePbrTextureSets,
  createSharedAtlasLayout,
  remapGeometryUvToAtlas
} from './TextureAtlas';

interface ExportMeshSnapshot {
  assigned: boolean;
  bake: BakeMeshSnapshot | null;
}

interface BakedTarget {
  readonly meshIndex: number;
  readonly snapshot: BakeMeshSnapshot;
  readonly maps: BakedTextureSet;
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
  if (source === undefined) throw new Error('Imported preview wrapper does not contain its source model.');
  return source;
}

function synchronizeCloneUuids(source: THREE.Object3D, clone: THREE.Object3D): void {
  const sourceObjects: THREE.Object3D[] = [];
  const cloneObjects: THREE.Object3D[] = [];
  source.traverse((object) => sourceObjects.push(object));
  clone.traverse((object) => cloneObjects.push(object));
  if (sourceObjects.length !== cloneObjects.length) throw new Error('Export clone does not match the current object hierarchy.');
  for (let index = 0; index < sourceObjects.length; index += 1) {
    const sourceObject = sourceObjects[index];
    const cloneObject = cloneObjects[index];
    if (sourceObject !== undefined && cloneObject !== undefined) cloneObject.uuid = sourceObject.uuid;
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
  resources: ExportResources,
  mipmaps: boolean
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  resources.textures.push(texture);
  return texture;
}

function createBakedMaterial(
  maps: BakedPbrTextureSet,
  settings: Readonly<PhysicalSettings>,
  name: string,
  resources: ExportResources,
  mipmaps = true
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    name,
    color: 0xffffff,
    map: canvasTexture(maps.albedo.canvas, `${name} albedo`, THREE.SRGBColorSpace, resources, mipmaps),
    roughness: 1,
    roughnessMap: canvasTexture(
      maps.roughness.canvas,
      `${name} roughness`,
      THREE.NoColorSpace,
      resources,
      mipmaps
    ),
    metalness: 1,
    metalnessMap: canvasTexture(
      maps.metallic.canvas,
      `${name} metallic`,
      THREE.NoColorSpace,
      resources,
      mipmaps
    ),
    aoMap: canvasTexture(maps.ao.canvas, `${name} ambient occlusion`, THREE.NoColorSpace, resources, mipmaps),
    aoMapIntensity: 1,
    emissive: 0xffffff,
    emissiveMap: canvasTexture(maps.emissive.canvas, `${name} emissive`, THREE.SRGBColorSpace, resources, mipmaps),
    emissiveIntensity: 1,
    normalMap: canvasTexture(maps.normal.canvas, `${name} normal`, THREE.NoColorSpace, resources, mipmaps),
    clearcoat: 1,
    clearcoatMap: canvasTexture(
      maps.clearcoat.canvas,
      `${name} clearcoat`,
      THREE.NoColorSpace,
      resources,
      mipmaps
    ),
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: canvasTexture(
      maps.clearcoatRoughness.canvas,
      `${name} clearcoat roughness`,
      THREE.NoColorSpace,
      resources,
      mipmaps
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

function assignGeometry(target: THREE.Mesh, geometry: THREE.BufferGeometry, resources: ExportResources): void {
  target.geometry = geometry;
  resources.geometries.push(geometry);
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
    maxTextureSize: number,
    microGeometry: Readonly<MicroGeometrySettings> = DEFAULT_MICRO_GEOMETRY
  ): Promise<Blob> {
    previewRoot.updateMatrixWorld(true);
    const sourceRoot = sourceForExport(previewRoot);
    const sourceMeshes = collectMeshes(sourceRoot);
    if (sourceMeshes.length === 0) throw new Error('There is no mesh geometry to export.');

    await this.baker.prepare();
    const physical = structuredClone(settings);
    const animations = sourceRoot.animations.map((clip) => clip.clone());
    const displacementExtent = this.compiler.displacementExtent;
    const bakeMaterial = this.compiler.createBakeMaterial(physical);
    const meshSnapshots: ExportMeshSnapshot[] = [];
    try {
      for (const source of sourceMeshes) {
        const assigned = this.compiler.isProceduralMaterial(source.material);
        meshSnapshots.push({ assigned, bake: assigned ? this.baker.snapshotMesh(source) : null });
      }
    } catch (error) {
      for (const snapshot of meshSnapshots) if (snapshot.bake !== null) this.baker.disposeSnapshot(snapshot.bake);
      bakeMaterial.dispose();
      throw error;
    }

    const exportRoot = cloneSkeletonSafe(sourceRoot);
    synchronizeCloneUuids(sourceRoot, exportRoot);
    const exportMeshes = collectMeshes(exportRoot);
    if (exportMeshes.length !== sourceMeshes.length) {
      for (const snapshot of meshSnapshots) if (snapshot.bake !== null) this.baker.disposeSnapshot(snapshot.bake);
      bakeMaterial.dispose();
      throw new Error('Export clone does not match the current mesh hierarchy.');
    }

    const resources: ExportResources = { materials: [], textures: [], geometries: [] };
    const assignedTargets = new Set<THREE.Mesh>();
    const assignedIndices: number[] = [];
    for (let index = 0; index < exportMeshes.length; index += 1) {
      if (meshSnapshots[index]?.assigned === true && exportMeshes[index] !== undefined) {
        assignedTargets.add(exportMeshes[index] as THREE.Mesh);
        assignedIndices.push(index);
      }
    }
    snapshotOriginalMaterials(exportRoot, assignedTargets, resources);
    cleanLabMetadata(exportRoot);

    try {
      const layout = EXPORT_CONFIG.sharedAtlas && assignedIndices.length > 1
        ? createSharedAtlasLayout(
            assignedIndices.length,
            bakeResolution,
            maxTextureSize,
            EXPORT_CONFIG.minAtlasTileSize
          )
        : null;
      const targetResolution = layout?.tileSize ?? bakeResolution;
      const bakedTargets: BakedTarget[] = [];

      for (const meshIndex of assignedIndices) {
        const snapshot = meshSnapshots[meshIndex];
        if (snapshot?.bake === null || snapshot?.bake === undefined) continue;
        const maps = await this.baker.bakeSnapshot(snapshot.bake, physical, targetResolution, bakeMaterial);
        bakedTargets.push({ meshIndex, snapshot: snapshot.bake, maps });
      }

      const sharedMaterial = layout === null
        ? null
        : createBakedMaterial(
            combinePbrTextureSets(bakedTargets.map((target) => target.maps), layout),
            physical,
            'PTL export atlas',
            resources,
            false
          );

      for (let slot = 0; slot < bakedTargets.length; slot += 1) {
        const baked = bakedTargets[slot];
        if (baked === undefined) continue;
        const target = exportMeshes[baked.meshIndex];
        if (target === undefined) continue;

        let exportGeometry: THREE.BufferGeometry | null = null;
        if (EXPORT_CONFIG.bakeStaticDisplacement && !baked.snapshot.dynamicGeometry && displacementExtent > 1e-8) {
          exportGeometry = applyStaticDisplacement(
            baked.snapshot.geometry,
            baked.maps.height,
            baked.snapshot.matrixWorld,
            displacementExtent,
            microGeometry
          );
        } else if (baked.snapshot.generatedUvAtlas) {
          exportGeometry = baked.snapshot.geometry.clone();
        } else if (layout !== null) {
          exportGeometry = target.geometry.clone();
        }

        if (layout !== null) {
          const atlasGeometry = remapGeometryUvToAtlas(exportGeometry ?? target.geometry, slot, layout);
          exportGeometry?.dispose();
          exportGeometry = atlasGeometry;
        }
        if (exportGeometry !== null) assignGeometry(target, exportGeometry, resources);

        target.material = sharedMaterial ?? createBakedMaterial(
          baked.maps,
          physical,
          `PTL export ${slot + 1}`,
          resources
        );
        target.customDepthMaterial = undefined;
        target.customDistanceMaterial = undefined;
      }

      const result = await new GLTFExporter().parseAsync(exportRoot, {
        binary: true,
        embedImages: true,
        onlyVisible: true,
        truncateDrawRange: true,
        forceIndices: true,
        includeCustomExtensions: false,
        maxTextureSize,
        animations
      });
      if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned an unexpected non-binary result.');
      return new Blob([result], { type: 'model/gltf-binary' });
    } finally {
      for (const snapshot of meshSnapshots) if (snapshot.bake !== null) this.baker.disposeSnapshot(snapshot.bake);
      bakeMaterial.dispose();
      disposeExportResources(resources);
    }
  }
}
