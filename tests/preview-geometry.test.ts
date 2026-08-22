import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createProceduralMesh } from '../src/engine/MeshFactory';

describe('procedural preview geometry', () => {
  it('welds rounded cube topology with enough density for smooth displacement', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createProceduralMesh('rounded-cube', material);

    try {
      const position = mesh.geometry.getAttribute('position');
      expect(mesh.geometry.index).not.toBeNull();
      expect(mesh.geometry.index?.count ?? 0).toBeGreaterThan(position.count);
      expect(position.count).toBeGreaterThan(3000);
      expect(mesh.geometry.getAttribute('normal')).toBeDefined();
    } finally {
      mesh.geometry.dispose();
      material.dispose();
    }
  });
});
