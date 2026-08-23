import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createTriangleAtlas, validateBakeUv } from '../src/export/UvValidation';

function triangleGeometry(uvs: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    2, 0, 0,
    3, 0, 0,
    2, 1, 0
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

describe('bake UV validation', () => {
  it('accepts separated UV islands', () => {
    const geometry = triangleGeometry([
      0.05, 0.05, 0.45, 0.05, 0.05, 0.45,
      0.55, 0.55, 0.95, 0.55, 0.55, 0.95
    ]);
    expect(() => validateBakeUv(geometry, 'valid')).not.toThrow();
    geometry.dispose();
  });

  it('rejects positive-area overlaps', () => {
    const geometry = triangleGeometry([
      0.05, 0.05, 0.75, 0.05, 0.05, 0.75,
      0.15, 0.15, 0.65, 0.15, 0.15, 0.65
    ]);
    expect(() => validateBakeUv(geometry, 'overlap')).toThrow(/overlapping or mirrored/i);
    geometry.dispose();
  });

  it('rejects tiled UV coordinates', () => {
    const geometry = triangleGeometry([
      0, 0, 1.2, 0, 0, 1,
      0.55, 0.55, 0.95, 0.55, 0.55, 0.95
    ]);
    expect(() => validateBakeUv(geometry, 'tiled')).toThrow(/out-of-range/i);
    geometry.dispose();
  });

  it('generates a deterministic valid per-triangle atlas', () => {
    const source = triangleGeometry([
      0, 0, 1.2, 0, 0, 1,
      0, 0, 1.2, 0, 0, 1
    ]);
    source.setAttribute('tangent', new THREE.Float32BufferAttribute(new Array(24).fill(0), 4));
    const first = createTriangleAtlas(source);
    const second = createTriangleAtlas(source);
    expect(Array.from(first.getAttribute('uv').array)).toEqual(Array.from(second.getAttribute('uv').array));
    expect(first.getAttribute('tangent')).toBeUndefined();
    expect(second.getAttribute('tangent')).toBeUndefined();
    expect(() => validateBakeUv(first, 'atlas')).not.toThrow();
    source.dispose();
    first.dispose();
    second.dispose();
  });
});
