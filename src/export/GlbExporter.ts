import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { MeshAssignments, PhysicalSettings } from '../materials/types';
import type { MaterialCompiler } from '../materials/MaterialCompiler';
import { TextureBaker, type BakedTextureSet } from './TextureBaker';

interface ExportOptions {
  root: THREE.Object3D;
  imported: boolean;
  meshAssignments: Readonly<MeshAssignments>;
  physical: Readonly<PhysicalSettings>;
  compiler: MaterialCompiler;
  textureSize: number;
}

interface ExportSnapshot {
  physical: PhysicalSettings;
  meshAssignments: Readonly<Record<string, boolean>>;
  bakeMaterial: THREE.ShaderMaterial;
  displacementExtent: number;
}

function clonePhysical(settings: Readonly<PhysicalSettings>): PhysicalSettings {
  return structuredClone(settings);
}

function cloneAssignments(assignments: Readonly<MeshAssignments>): Readonly<Record<string, boolean>> {
  return Object.freeze({ ...assignments });
}

function sourceForExport(root: THREE.Object3D, imported: boolean): THREE.Object3D {
  if (!imported || root.userData.labPreviewWrapper !== true) {
    return root;
  }
  const source = root.children[0];
  if (source === undefined) {
    throw new Error('Imported model preview wrapper does not contain the source model.');
  }
  return source;
}

function materialForBake(
  baked: BakedTextureSet,
  physical: Readonly<PhysicalSettings>
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: physical.roughness,
    metalness: physical.metalness,
    clearcoat: physical.clearcoat,
    clearcoatRoughness: physical.clearcoatRoughness,
    specularIntensity: physical.specularIntensity,
    ior: physical.ior,
    sheen: physical.sheen,
    sheenRoughness: physical.sheenRoughness,
    sheenColor: new THREE.Color(physical.sheenColor),
    transmission: physical.transmission,
    thickness: physical.thickness,
    attenuationDistance: physical.attenuationDistance,
    attenuationColor: new THREE.Color(physical.attenuationColor)
  });
  material.map = baked.albedo;
  material.roughnessMap = baked.roughness;
  material.normalMap = baked.normal;
  material.clearcoatMap = baked.clearcoat;
  material.clearcoatRoughnessMap = baked.clearcoatRoughness;
  material.normalScale.set(1, 1);
  material.needsUpdate = true;
  return material;
}

function disposeMaterial(material: THREE.Material): void {
  const candidate = material as THREE.Material & Record<string, unknown>;
  for (const value of Object.values(candidate)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

export class GlbExporter {
  public constructor(private readonly renderer: THREE.WebGLRenderer) {}

  public async export(options: ExportOptions): Promise<Blob> {
    const sourceRoot = sourceForExport(options.root, options.imported);
    sourceRoot.updateMatrixWorld(true);
    const exportRoot = sourceRoot.clone(true);
    exportRoot.updateMatrixWorld(true);

    const physical = clonePhysical(options.physical);
    const snapshot: ExportSnapshot = {
      physical,
      meshAssignments: cloneAssignments(options.meshAssignments),
      bakeMaterial: options.compiler.createBakeMaterial(physical),
      displacementExtent: options.compiler.displacementExtent
    };

    const baker = new TextureBaker(this.renderer);
    const generatedMaterials: THREE.Material[] = [];

    try {
      const sourceMeshes = new Map<string, THREE.Mesh>();
      sourceRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const id = object.userData.labMeshId;
        if (typeof id === 'string') sourceMeshes.set(id, object);
      });

      const exportMeshes: THREE.Mesh[] = [];
      exportRoot.traverse((object) => {
        if (object instanceof THREE.Mesh) exportMeshes.push(object);
      });

      for (const mesh of exportMeshes) {
        const id = mesh.userData.labMeshId;
        const assigned = !options.imported || (typeof id === 'string' && snapshot.meshAssignments[id] !== false);
        if (!assigned) continue;

        const sourceMesh = typeof id === 'string' ? sourceMeshes.get(id) : undefined;
        const bakeSource = sourceMesh ?? mesh;
        const baked = await baker.bake({
          mesh: bakeSource,
          material: snapshot.bakeMaterial,
          physical: snapshot.physical,
          size: options.textureSize,
          displacementExtent: snapshot.displacementExtent
        });
        const material = materialForBake(baked, snapshot.physical);
        generatedMaterials.push(material);
        mesh.material = material;
      }

      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(exportRoot, {
        binary: true,
        onlyVisible: true
      });
      if (!(result instanceof ArrayBuffer)) {
        throw new Error('GLB exporter did not return binary output.');
      }
      return new Blob([result], { type: 'model/gltf-binary' });
    } finally {
      snapshot.bakeMaterial.dispose();
      baker.dispose();
      for (const material of generatedMaterials) disposeMaterial(material);
    }
  }
}
