import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeObjectResources } from './ObjectResources';

const SUPPORTED_EXTENSIONS = new Set(['glb', 'gltf']);
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const PREVIEW_SIZE = 2.35;

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertNoExternalUris(value: unknown, path = 'gltf'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoExternalUris(item, `${path}[${index}]`));
    return;
  }

  const record = asRecord(value);
  if (record === null) {
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === 'uri' && typeof child === 'string' && !child.startsWith('data:')) {
      throw new Error(
        `External GLTF resource at ${path}.uri is not supported. Use GLB or a self-contained GLTF.`
      );
    }
    assertNoExternalUris(child, `${path}.${key}`);
  }
}

function parseGltfJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error('The GLTF file does not contain valid JSON.', { cause: error });
  }
}

function readGlbJson(buffer: ArrayBuffer): unknown {
  if (buffer.byteLength < GLB_HEADER_BYTES) {
    throw new Error('The GLB file is truncated.');
  }

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('The file is not a valid GLB container.');
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error('Only GLB version 2 is supported.');
  }

  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== buffer.byteLength) {
    throw new Error('The GLB container length is invalid.');
  }

  let offset = GLB_HEADER_BYTES;
  while (offset + GLB_CHUNK_HEADER_BYTES <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + GLB_CHUNK_HEADER_BYTES;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkEnd > buffer.byteLength) {
      throw new Error('The GLB container contains a truncated chunk.');
    }

    if (chunkType === GLB_JSON_CHUNK) {
      const bytes = new Uint8Array(buffer, chunkStart, chunkLength);
      const text = new TextDecoder().decode(bytes).replace(/\u0000+$/u, '').trim();
      return parseGltfJson(text);
    }

    offset = chunkEnd;
  }

  throw new Error('The GLB container does not contain a JSON chunk.');
}

export class ModelLoader {
  private readonly loader = new GLTFLoader();
  private loadSequence = 0;

  public async load(file: File): Promise<THREE.Object3D | null> {
    const sequence = ++this.loadSequence;

    try {
      const extension = fileExtension(file.name);
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error('Only GLB and GLTF files are supported.');
      }

      let payload: ArrayBuffer | string;
      if (extension === 'glb') {
        payload = await file.arrayBuffer();
        assertNoExternalUris(readGlbJson(payload));
      } else {
        payload = await file.text();
        assertNoExternalUris(parseGltfJson(payload));
      }

      if (sequence !== this.loadSequence) {
        return null;
      }

      const gltf = await this.loader.parseAsync(payload, '');

      try {
        const normalized = this.normalize(gltf.scene, file.name);
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
      if (sequence !== this.loadSequence) {
        return null;
      }
      throw error;
    }
  }

  private normalize(root: THREE.Object3D, name: string): THREE.Object3D {
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

    const scale = PREVIEW_SIZE / largestDimension;
    const normalized = new THREE.Group();
    normalized.name = name;
    normalized.add(root);
    normalized.scale.setScalar(scale);
    normalized.position.copy(center).multiplyScalar(-scale);
    normalized.updateMatrixWorld(true);
    return normalized;
  }
}
