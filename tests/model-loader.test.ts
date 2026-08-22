import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_MESH_LABEL_LENGTH } from '../src/app/constants';
import { describeImportedMeshes } from '../src/engine/ModelLoader';

describe('imported mesh descriptions', () => {
  it('uses the configured mesh label limit', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.userData.labMeshId = 'mesh-0';
    mesh.userData.labMeshLabel = 'x'.repeat(MAX_MESH_LABEL_LENGTH + 25);
    root.add(mesh);

    expect(describeImportedMeshes(root)).toEqual([
      { id: 'mesh-0', label: 'x'.repeat(MAX_MESH_LABEL_LENGTH) }
    ]);

    mesh.geometry.dispose();
  });
});
