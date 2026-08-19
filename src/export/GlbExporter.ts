import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as cloneSkeletonSafe } from 'three/addons/utils/SkeletonUtils.js';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import { TextureBaker, type BakedPbrTextureSet } from './TextureBaker';

interface ExportResources {
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function cleanLabMetadata(root: THREE.Object3D): void {
  root.traverse((object) => {
    delete object.userData.labMeshId;
    delete object.userData.labMeshLabel;
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
    roughnessMap: canvasTexture(
      maps.roughness.canvas,
      `${prefix} roughness`,
      THREE.NoColorSpace,
      resources
    ),
    metalness: settings.metalness,
    normalMap: canvasTexture(maps.normal.canvas, `${prefix} normal`, THREE.NoColorSpace, resources),
    clearcoat: 1,
    clearcoatMap: canvasTexture(
      maps.clearcoat.canvas,
      `${prefix} clearcoat`,
      THREE.NoColorSpace,
      resources
    ),
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

function disposeResources(resources: ExportResources): void {
  resources.materials.forEach((material) => material.dispose());
  resources.textures.forEach((texture) => texture.dispose());
}

export class GlbExporter {
  private readonly exporter = new GLTFExporter();

  public constructor(
    private readonly baker: TextureBaker,
    private readonly compiler: MaterialCompiler
  ) {}

  public async export(
    sourceRoot: THREE.Object3D,
    settings: Readonly<PhysicalSettings>,
    bakeResolution: number,
    maxTextureSize: number
  ): Promise<Blob> {
    sourceRoot.updateMatrixWorld(true);
    const sourceMeshes = collectMeshes(sourceRoot);
    if (sourceMeshes.length === 0) {
      throw new Error('There is no mesh geometry to export.');
    }

    const exportRoot = cloneSkeletonSafe(sourceRoot);
    const exportMeshes = collectMeshes(exportRoot);
    if (exportMeshes.length !== sourceMeshes.length) {
      throw new Error('Export clone does not match the current mesh hierarchy.');
    }

    cleanLabMetadata(exportRoot);
    const resources: ExportResources = { materials: [], textures: [] };

    try {
      for (let index = 0; index < sourceMeshes.length; index += 1) {
        const source = sourceMeshes[index];
        const target = exportMeshes[index];
        if (source === undefined || target === undefined) continue;
        if (source.material !== this.compiler.material) continue;

        const maps = await this.baker.bakePbr(source, settings, bakeResolution);
        target.material = createBakedMaterial(maps, settings, index, resources);
        target.customDepthMaterial = undefined;
        target.customDistanceMaterial = undefined;
      }

      const result = await this.exporter.parseAsync(exportRoot, {
        binary: true,
        embedImages: true,
        onlyVisible: true,
        truncateDrawRange: true,
        forceIndices: true,
        includeCustomExtensions: false,
        maxTextureSize
      });
      if (!(result instanceof ArrayBuffer)) {
        throw new Error('GLB exporter returned an unexpected non-binary result.');
      }
      return new Blob([result], { type: 'model/gltf-binary' });
    } finally {
      disposeResources(resources);
    }
  }
}
