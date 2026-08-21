import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAX_MODEL_FILE_BYTES } from '../app/constants';
import type { ImportedMeshTarget } from '../materials/types';
import {
  collectExternalUris,
  createBundleIndex,
  isDataUri,
  primaryBundlePath,
  resolveBundleFile
} from './GltfBundleResolver';
import { disposeObjectResources } from './ObjectResources';

const SUPPORTED_EXTENSIONS = new Set(['glb', 'gltf']);
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_ALIGNMENT_BYTES = 4;
const PREVIEW_SIZE = 2.35;
const BYTES_PER_MIB = 1024 * 1024;

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

function parseGltfJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error('The GLTF file does not contain valid JSON.', { cause: error });
  }
}

function decodeUtf8(bytes: Uint8Array, errorMessage: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(errorMessage, { cause: error });
  }
}

function decodeGlbJson(bytes: Uint8Array): unknown {
  const text = decodeUtf8(bytes, 'The GLB JSON chunk is not valid UTF-8.');
  return parseGltfJson(text.replace(/\u0000+$/u, '').trim());
}

function readGlbJson(buffer: ArrayBuffer): unknown {
  if (buffer.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) throw new Error('The GLB file is truncated.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('The file is not a valid GLB container.');
  if (view.getUint32(4, true) !== GLB_VERSION) throw new Error('Only GLB version 2 is supported.');
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('The GLB container length is invalid.');

  let offset = GLB_HEADER_BYTES;
  let json: unknown;
  let chunkIndex = 0;
  while (offset < buffer.byteLength) {
    if (offset + GLB_CHUNK_HEADER_BYTES > buffer.byteLength) {
      throw new Error('The GLB container contains trailing incomplete data.');
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + GLB_CHUNK_HEADER_BYTES;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkLength % GLB_ALIGNMENT_BYTES !== 0) throw new Error('The GLB container contains a misaligned chunk.');
    if (chunkEnd > buffer.byteLength) throw new Error('The GLB container contains a truncated chunk.');
    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK) throw new Error('The first GLB chunk must contain JSON.');
    if (chunkType === GLB_JSON_CHUNK) {
      if (json !== undefined) throw new Error('The GLB container contains multiple JSON chunks.');
      json = decodeGlbJson(new Uint8Array(buffer, chunkStart, chunkLength));
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (json === undefined) throw new Error('The GLB container does not contain a JSON chunk.');
  return json;
}

function primaryFile(files: readonly File[]): File {
  const candidates = files.filter((file) => SUPPORTED_EXTENSIONS.has(fileExtension(file.name)));
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new Error('Select exactly one GLB or GLTF primary file with its optional external resources.');
  }
  return candidates[0];
}

function hasMeshGeometry(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    found ||= position !== undefined && position.count > 0;
  });
  return found;
}

function annotateMeshes(root: THREE.Object3D): void {
  let meshIndex = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.userData.labMeshId = `mesh-${meshIndex}`;
    object.userData.labMeshLabel = object.name.trim().length > 0 ? object.name : `Mesh ${meshIndex + 1}`;
    meshIndex += 1;
  });
}

export function describeImportedMeshes(root: THREE.Object3D): ImportedMeshTarget[] {
  const result: ImportedMeshTarget[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const id = object.userData.labMeshId;
    const label = object.userData.labMeshLabel;
    if (typeof id === 'string' && typeof label === 'string') result.push({ id, label: label.slice(0, 160) });
  });
  return result;
}

export class ModelLoader {
  private loadSequence = 0;

  public cancelPending(): void {
    this.loadSequence += 1;
  }

  public async load(input: File | readonly File[]): Promise<THREE.Object3D | null> {
    const sequence = ++this.loadSequence;
    const files = input instanceof File ? [input] : [...input];

    try {
      if (files.length === 0) throw new Error('No model files were selected.');
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      if (totalBytes > MAX_MODEL_FILE_BYTES) {
        const limitMiB = Math.round(MAX_MODEL_FILE_BYTES / BYTES_PER_MIB);
        throw new Error(`Model bundle exceeds the configured ${limitMiB} MiB limit.`);
      }

      const primary = primaryFile(files);
      const extension = fileExtension(primary.name);
      let payload: ArrayBuffer | string;
      let gltfJson: unknown;
      if (extension === 'glb') {
        payload = await primary.arrayBuffer();
        gltfJson = readGlbJson(payload);
      } else {
        const bytes = new Uint8Array(await primary.arrayBuffer());
        payload = decodeUtf8(bytes, 'The GLTF file is not valid UTF-8.');
        gltfJson = parseGltfJson(payload);
      }

      const bundleIndex = createBundleIndex(files);
      const primaryPath = primaryBundlePath(primary, bundleIndex);
      for (const uri of collectExternalUris(gltfJson)) resolveBundleFile(uri, bundleIndex, primaryPath);
      if (sequence !== this.loadSequence) return null;

      const manager = new THREE.LoadingManager();
      const objectUrls = new Map<File, string>();
      manager.setURLModifier((url) => {
        if (isDataUri(url) || url.startsWith('blob:')) return url;
        const file = resolveBundleFile(url, bundleIndex, primaryPath);
        let objectUrl = objectUrls.get(file);
        if (objectUrl === undefined) {
          objectUrl = URL.createObjectURL(file);
          objectUrls.set(file, objectUrl);
        }
        return objectUrl;
      });

      const loader = new GLTFLoader(manager);
      let gltf;
      try {
        gltf = await loader.parseAsync(payload, '');
      } finally {
        for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      }

      try {
        const normalized = this.normalize(gltf.scene, primary.name, gltf.animations);
        if (sequence !== this.loadSequence) {
          disposeObjectResources(normalized);
          return null;
        }
        return normalized;
      } catch (error) {
        disposeObjectResources(gltf.scene);
        throw error;
      }
    } catch (error) {
      if (sequence !== this.loadSequence) return null;
      throw error;
    }
  }

  private normalize(root: THREE.Object3D, name: string, animations: readonly THREE.AnimationClip[]): THREE.Object3D {
    root.updateMatrixWorld(true);
    if (!hasMeshGeometry(root)) throw new Error('The imported model does not contain mesh geometry.');
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) throw new Error('The imported model does not contain visible geometry.');
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestDimension) || largestDimension <= 0) throw new Error('The imported model has invalid bounds.');

    annotateMeshes(root);
    root.userData.labImportedSource = true;
    root.animations = animations.map((clip) => clip.clone());
    const scale = PREVIEW_SIZE / largestDimension;
    const normalized = new THREE.Group();
    normalized.name = name;
    normalized.userData.labPreviewWrapper = true;
    normalized.userData.labPreviewScale = scale;
    normalized.userData.labPreviewCenter = center.toArray();
    normalized.add(root);
    normalized.scale.setScalar(scale);
    normalized.position.copy(center).multiplyScalar(-scale);
    normalized.updateMatrixWorld(true);
    return normalized;
  }
}
