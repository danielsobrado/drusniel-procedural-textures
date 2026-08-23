import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createProceduralMesh } from '../src/engine/MeshFactory';

const POSITION_PRECISION = 100_000;
const RADIAL_NORMAL_MIN_DOT = 0.999;

function positionKey(position: THREE.BufferAttribute, index: number): string {
  return [
    Math.round(position.getX(index) * POSITION_PRECISION),
    Math.round(position.getY(index) * POSITION_PRECISION),
    Math.round(position.getZ(index) * POSITION_PRECISION)
  ].join(':');
}

describe('procedural preview geometry', () => {
  it('welds the icosphere so shader displacement cannot split triangle edges', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createProceduralMesh('icosphere', material);

    try {
      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      expect(position).toBeInstanceOf(THREE.BufferAttribute);
      expect(normal).toBeInstanceOf(THREE.BufferAttribute);
      expect(mesh.geometry.index).not.toBeNull();

      const uniquePositions = new Set<string>();
      for (let index = 0; index < position.count; index += 1) {
        uniquePositions.add(positionKey(position as THREE.BufferAttribute, index));

        const px = position.getX(index);
        const py = position.getY(index);
        const pz = position.getZ(index);
        const nx = normal.getX(index);
        const ny = normal.getY(index);
        const nz = normal.getZ(index);
        const inverseLength = 1 / Math.max(Math.hypot(px, py, pz), Number.EPSILON);
        const radialDot = (px * nx + py * ny + pz * nz) * inverseLength;
        expect(radialDot).toBeGreaterThan(RADIAL_NORMAL_MIN_DOT);
      }

      expect(uniquePositions.size).toBe(position.count);
    } finally {
      mesh.geometry.dispose();
      material.dispose();
    }
  });
});
