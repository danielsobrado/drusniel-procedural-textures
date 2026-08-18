import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SUPPORTED_EXTENSIONS = new Set(['glb', 'gltf']);

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

export class ModelLoader {
  private readonly loader = new GLTFLoader();

  public async load(file: File): Promise<THREE.Object3D> {
    const extension = fileExtension(file.name);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error('Only GLB and GLTF files are supported.');
    }

    const payload: ArrayBuffer | string =
      extension === 'glb' ? await file.arrayBuffer() : await file.text();

    const gltf = await this.loader.parseAsync(payload, '');
    const root = gltf.scene;
    root.name = file.name;
    this.normalize(root);
    return root;
  }

  private normalize(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) {
      throw new Error('The imported model does not contain visible geometry.');
    }

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z);

    if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
      throw new Error('The imported model has invalid bounds.');
    }

    const scale = 2.35 / largestDimension;
    root.scale.multiplyScalar(scale);
    root.position.sub(center.multiplyScalar(scale));
    root.updateMatrixWorld(true);
  }
}
