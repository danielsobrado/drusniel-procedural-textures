import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAX_MODEL_FILE_BYTES } from '../app/constants';
import type { ImportedMeshTarget } from '../materials/types';
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
const REMOTE_URI = /^(?:https?:|file:|blob:|\/\/)/i;

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

function collectExternalUris(value: unknown): string[] {
  const uris = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current.filter(isContainer));
      continue;
    }
    const record = asRecord(current);
    if (record === null) {
      continue;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'uri' && typeof child === 'string' && !DATA_URI.test(child)) {
        if (REMOTE_URI.test(child)) {
          throw new Error(`Remote GLTF resource URIs are not supported: ${child}`);
        }
        uris.add(child);
      } else if (isContainer(child)) {
        pending.push(child);
      }
    }
  }
  return [...uris];
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
  if (view.getUint32(8, true) !== buffer.byteLength) {
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

function normalizeResourcePath(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  return decoded
    .split(/[?#]/u, 1)[0]
    ?.replaceAll('\\', '/')
    .replace(/^\.\//u, '') ?? '';
}

function canonicalBundlePath(value: string): string {
  const parts = normalizeResourcePath(value).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function basename(value: string): string {
  return canonicalBundlePath(value).split('/').at(-1) ?? '';
}

function dirname(value: string): string {
  const normalized = canonicalBundlePath(value);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

function joinBundlePath(base: string, relative: string): string {
  return canonicalBundlePath(base.length === 0 ? relative : `${base}/${relative}`);
}

function bundleKeys(file: File): string[] {
  const relative = file.webkitRelativePath?.trim();
  return relative === undefined || relative.length === 0
    ? [file.name]
    : [relative, file.name];
}

function createBundleIndex(files: readonly File[]): Map<string, File[]> {
  const index = new Map<string, File[]>();
  for (const file of files) {
    for (const key of bundleKeys(file)) {
      const normalized = canonicalBundlePath(key);
      const values = index.get(normalized) ?? [];
      if (!values.includes(file)) {
        values.push(file);
      }
      index.set(normalized, values);
    }
  }
  return index;
}

function primaryBundlePath(primary: File, index: ReadonlyMap<string, File[]>): string {
  for (const [path, files] of index) {
    if (files.includes(primary) && path !== primary.name) {
      return path;
    }
  }
  return primary.name;
}

function resolveBundleFile(
  uri: string,
  index: ReadonlyMap<string, File[]>,
  primaryPath: string
): File {
  const normalized = canonicalBundlePath(uri);
  const primaryRelative = joinBundlePath(dirname(primaryPath), normalized);
  for (const candidate of [primaryRelative, normalized]) {
    const exact = index.get(candidate);
    if (exact?.length === 1 && exact[0] !== undefined) {
      return exact[0];
    }
    if ((exact?.length ?? 0) > 1) {
      throw new Error(`GLTF resource "${uri}" is ambiguous in the selected bundle.`);
    }
  }

  const wantedBasename = basename(normalized);
  const matches = new Set<File>();
  for (const [path, files] of index) {
    if (basename(path) === wantedBasename) {
      files.forEach((file) => matches.add(file));
    }
  }
  if (matches.size === 1) {
    return [...matches][0] as File;
  }
  if (matches.size > 1) {
    throw new Error(`GLTF resource "${uri}" is ambiguous in the selected bundle.`);
  }
  throw new Error(`GLTF resource "${uri}" is missing. Select the GLTF, BIN and texture files together.`);
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
    if (object instanceof THREE.Mesh) {
      const position = object.geometry.getAttribute('position');
      found ||= position !== undefined && position.count > 0;
    }
  });
  return found;
}

function annotateMeshes(root: THREE.Object3D): void {
  let meshIndex = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const id = `mesh-${meshIndex}`;
    const label = object.name.trim().length > 0 ? object.name : `Mesh ${meshIndex + 1}`;
    object.userData.labMeshId = id;
    object.userData.labMeshLabel = label;
    meshIndex += 1;
  });
}

export function describeImportedMeshes(root: THREE.Object3D): ImportedMeshTarget[] {
  const result: ImportedMeshTarget[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const id = object.userData.labMeshId;
    const label = object.userData.labMeshLabel;
    if (typeof id === 'string' && typeof label === 'string') {
      result.push({ id, label: label.slice(0, 160) });
    }
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
      if (files.length === 0) {
        throw new Error('No model files were selected.');
      }
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

      const externalUris = collectExternalUris(gltfJson);
      const bundleIndex = createBundleIndex(files);
      const primaryPath = primaryBundlePath(primary, bundleIndex);
      for (const uri of externalUris) {
        resolveBundleFile(uri, bundleIndex, primaryPath);
      }

      if (sequence !== this.loadSequence) {
        return null;
      }

      const manager = new THREE.LoadingManager();
      const objectUrls = new Map<File, string>();
      manager.setURLModifier((url) => {
        if (DATA_URI.test(url) || url.startsWith('blob:')) {
          return url;
        }
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
        for (const url of objectUrls.values()) {
          URL.revokeObjectURL(url);
        }
      }

      try {
        const normalized = this.normalize(gltf.scene, primary.name);
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

    annotateMeshes(root);
    root.userData.labImportedSource = true;
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
