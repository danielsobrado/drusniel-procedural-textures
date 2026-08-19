import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAX_MODEL_FILE_BYTES } from '../app/constants';
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
const DATA_URI = /^data:/i;

function fileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || asRecord(value) !== null;
}

function assertNoExternalUris(value: unknown): void {
  const pending: Array<{ value: unknown; path: string }> = [{ value, path: 'gltf' }];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) {
      break;
    }

    if (Array.isArray(entry.value)) {
      entry.value.forEach((item, index) => {
        if (isContainer(item)) {
          pending.push({ value: item, path: `${entry.path}[${index}]` });
        }
      });
      continue;
    }

    const record = asRecord(entry.value);
    if (record === null) {
      continue;
    }

    for (const [key, child] of Object.entries(record)) {
      const childPath = `${entry.path}.${key}`;
      if (key === 'uri' && typeof child === 'string' && !DATA_URI.test(child)) {
        throw new Error(
          `External GLTF resource at ${childPath} is not supported. Use GLB or a self-contained GLTF.`
        );
      }
      if (isContainer(child)) {
        pending.push({ value: child, path: childPath });
      }
    }
  }
}

function parseGltfJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error('The GLTF file does not contain valid JSON.', { cause: error });
  }
}

function decodeGlbJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('The GLB JSON chunk is not valid UTF-8.', { cause: error });
  }

  return parseGltfJson(text.replace(/\u0000+$/u, '').trim());
}

function readGlbJson(buffer: ArrayBuffer): unknown {
  if (buffer.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) {
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

    if (chunkLength % GLB_ALIGNMENT_BYTES !== 0) {
      throw new Error('The GLB container contains a misaligned chunk.');
    }
    if (chunkEnd > buffer.byteLength) {
      throw new Error('The GLB container contains a truncated chunk.');
    }
    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK) {
      throw new Error('The first GLB chunk must contain JSON.');
    }

    if (chunkType === GLB_JSON_CHUNK) {
      if (json !== undefined) {
        throw new Error('The GLB container contains multiple JSON chunks.');
      }
      json = decodeGlbJson(new Uint8Array(buffer, chunkStart, chunkLength));
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (json === undefined) {
    throw new Error('The GLB container does not contain a JSON chunk.');
  }

  return json;
}

function hasMeshGeometry(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const position = object.geometry.getAttribute('position');
    if (position !== undefined && position.count > 0) {
      found = true;
    }
  });
  return found;
}

export class ModelLoader {
  private readonly loader = new GLTFLoader();
  private loadSequence = 0;

  public cancelPending(): void {
    this.loadSequence += 1;
  }

  public async load(file: File): Promise<THREE.Object3D | null> {
    const sequence = ++this.loadSequence;

    try {
      if (file.size > MAX_MODEL_FILE_BYTES) {
        const limitMiB = Math.round(MAX_MODEL_FILE_BYTES / BYTES_PER_MIB);
        throw new Error(`Model file exceeds the configured ${limitMiB} MiB limit.`);
      }

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

    if (!hasMeshGeometry(root)) {
      throw new Error('The imported model does not contain mesh geometry.');
    }

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
