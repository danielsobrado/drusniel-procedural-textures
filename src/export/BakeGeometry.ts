import * as THREE from 'three';
import { EXPORT_CONFIG } from '../app/constants';
import { createTriangleAtlas, validateBakeUv } from './UvValidation';

/**
 * The geometry half of a bake, shared by the WebGL2 and WebGPU bakers. Both need the same
 * UV unwrap, the same automatic atlas packing rules and the same row flip, and those rules
 * decide what the output looks like - so they must not be reimplemented per backend.
 */
export interface BakeMeshSnapshot {
  readonly geometry: THREE.BufferGeometry;
  readonly matrixWorld: THREE.Matrix4;
  readonly name: string;
  readonly generatedUvAtlas: boolean;
  readonly dynamicGeometry: boolean;
}

function hasMorphTargets(mesh: THREE.Mesh): boolean {
  return Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0);
}

function isDynamicGeometry(mesh: THREE.Mesh): boolean {
  return mesh instanceof THREE.SkinnedMesh || hasMorphTargets(mesh);
}

function needsDeformedGeometry(mesh: THREE.Mesh): boolean {
  return mesh instanceof THREE.SkinnedMesh ||
    (mesh.morphTargetInfluences?.some((value) => Math.abs(value) > 1e-8) ?? false);
}

export function createBakeGeometry(
  mesh: THREE.Mesh
): { geometry: THREE.BufferGeometry; generatedUvAtlas: boolean; dynamicGeometry: boolean } {
  if (mesh instanceof THREE.InstancedMesh) {
    throw new Error('Instanced meshes must be converted to regular meshes before texture baking.');
  }

  const sourcePosition = mesh.geometry.getAttribute('position');
  if (sourcePosition === undefined || sourcePosition.count === 0) {
    throw new Error(`Mesh "${mesh.name || 'Unnamed mesh'}" has no positions to bake.`);
  }

  const dynamicGeometry = isDynamicGeometry(mesh);
  let geometry = mesh.geometry.clone();
  if (needsDeformedGeometry(mesh)) {
    const vertex = new THREE.Vector3();
    const positions = new Float32Array(sourcePosition.count * 3);
    for (let index = 0; index < sourcePosition.count; index += 1) {
      mesh.getVertexPosition(index, vertex);
      const offset = index * 3;
      positions[offset] = vertex.x;
      positions[offset + 1] = vertex.y;
      positions[offset + 2] = vertex.z;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.deleteAttribute('normal');
  }
  if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals();

  const meshName = mesh.name || 'Unnamed mesh';
  try {
    validateBakeUv(geometry, meshName);
    return { geometry, generatedUvAtlas: false, dynamicGeometry };
  } catch (error) {
    const canAutoPack = mesh.userData.labProceduralPreview === true ||
      (EXPORT_CONFIG.automaticUvPacking && !dynamicGeometry);
    if (!canAutoPack) {
      geometry.dispose();
      if (dynamicGeometry && EXPORT_CONFIG.automaticUvPacking) {
        throw new Error(
          `Mesh "${meshName}" needs a unique 0–1 UV unwrap. Automatic packing is intentionally disabled for ` +
          'skinned or morph-target meshes because changing their vertex topology can invalidate animation data.',
          { cause: error }
        );
      }
      throw error;
    }
    const atlas = createTriangleAtlas(geometry);
    geometry.dispose();
    validateBakeUv(atlas, meshName);
    return { geometry: atlas, generatedUvAtlas: true, dynamicGeometry };
  }
}

export function snapshotBakeMesh(source: THREE.Mesh): BakeMeshSnapshot {
  source.updateMatrixWorld(true);
  const bake = createBakeGeometry(source);
  return {
    geometry: bake.geometry,
    matrixWorld: source.matrixWorld.clone(),
    name: source.name || 'Unnamed mesh',
    generatedUvAtlas: bake.generatedUvAtlas,
    dynamicGeometry: bake.dynamicGeometry
  };
}

export function disposeBakeSnapshot(snapshot: BakeMeshSnapshot): void {
  snapshot.geometry.dispose();
}

/**
 * Render targets read back bottom-up while canvases are top-down. Flipping in place reuses
 * the readback buffer rather than allocating a second full-resolution copy per channel.
 */
export function flipRowsInPlace(
  source: Uint8Array<ArrayBuffer>,
  width: number,
  height: number
): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = width * 4;
  const pixels = new Uint8ClampedArray(source.buffer, source.byteOffset, source.byteLength);
  const row = new Uint8ClampedArray(rowBytes);
  const halfHeight = Math.floor(height / 2);
  for (let y = 0; y < halfHeight; y += 1) {
    const topOffset = y * rowBytes;
    const bottomOffset = (height - y - 1) * rowBytes;
    row.set(pixels.subarray(topOffset, topOffset + rowBytes));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
    pixels.set(row, bottomOffset);
  }
  return pixels;
}
