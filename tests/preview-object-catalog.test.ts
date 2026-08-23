import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OBJECT_PRESETS } from '../src/app/constants';
import { createProceduralMesh } from '../src/engine/MeshFactory';
import type { ObjectPreset } from '../src/materials/types';

const ADDED_PRESETS: readonly ObjectPreset[] = [
  'cylinder',
  'cone',
  'capsule',
  'octahedron',
  'dodecahedron',
  'torus-knot'
];

const ALL_PRESETS: readonly ObjectPreset[] = [
  'sphere',
  'icosphere',
  'cube',
  'rounded-cube',
  'torus',
  'plane',
  ...ADDED_PRESETS
];

const CAPSULE_RADIUS = 0.64;
const CAPSULE_HALF_BODY_LENGTH = 0.56;
const CAPSULE_RADIUS_TOLERANCE = 0.001;
const CAPSULE_Y_PRECISION = 100_000;
const CAPSULE_MIN_BODY_LEVELS = 70;

describe('preview object catalog', () => {
  it('keeps six existing objects followed by six additional probes', () => {
    expect(OBJECT_PRESETS.map((preset) => preset.id)).toEqual(ALL_PRESETS);
  });

  it.each(ADDED_PRESETS)('creates valid %s preview geometry', (preset) => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createProceduralMesh(preset, material);

    try {
      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      expect(position).toBeInstanceOf(THREE.BufferAttribute);
      expect(normal).toBeInstanceOf(THREE.BufferAttribute);
      expect(position.count).toBeGreaterThan(16);
      expect(normal.count).toBe(position.count);
      expect(mesh.userData.labProceduralPreview).toBe(true);
      expect(mesh.userData.labObjectPreset).toBe(preset);

      mesh.geometry.computeBoundingSphere();
      expect(mesh.geometry.boundingSphere).not.toBeNull();
      expect(Number.isFinite(mesh.geometry.boundingSphere?.radius ?? Number.NaN)).toBe(true);
      expect(mesh.geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(0);
    } finally {
      mesh.geometry.dispose();
      material.dispose();
    }
  });

  it('densely tessellates the capsule body for procedural displacement', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createProceduralMesh('capsule', material);

    try {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const bodyLevels = new Set<number>();

      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const y = position.getY(index);
        const z = position.getZ(index);
        const radius = Math.hypot(x, z);
        if (
          Math.abs(radius - CAPSULE_RADIUS) <= CAPSULE_RADIUS_TOLERANCE &&
          y >= -CAPSULE_HALF_BODY_LENGTH &&
          y <= CAPSULE_HALF_BODY_LENGTH
        ) {
          bodyLevels.add(Math.round(y * CAPSULE_Y_PRECISION));
        }
      }

      expect(bodyLevels.size).toBeGreaterThanOrEqual(CAPSULE_MIN_BODY_LEVELS);
    } finally {
      mesh.geometry.dispose();
      material.dispose();
    }
  });
});
