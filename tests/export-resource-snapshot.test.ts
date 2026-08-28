import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  cloneMaterialSet,
  snapshotOriginalMaterials,
  type ExportResources
} from '../src/export/ExportResourceSnapshot';

describe('export material snapshots', () => {
  it('clones every material in a multi-material mesh without sharing mutable instances', () => {
    const first = new THREE.MeshPhysicalMaterial({ name: 'First', roughness: 0.2 });
    const second = new THREE.MeshStandardMaterial({ name: 'Second', metalness: 0.8 });
    const resources: ExportResources = { materials: [], textures: [], geometries: [] };
    const cloned = cloneMaterialSet([first, second], resources);
    expect(Array.isArray(cloned)).toBe(true);
    const materials = cloned as THREE.Material[];
    expect(materials).toHaveLength(2);
    expect(materials[0]).not.toBe(first);
    expect(materials[1]).not.toBe(second);
    expect(materials[0]?.name).toBe('First');
    expect(materials[1]?.name).toBe('Second');
    expect(resources.materials).toEqual(materials);
    first.dispose();
    second.dispose();
    resources.materials.forEach((material) => material.dispose());
  });

  it('preserves shared material and texture identity across an export snapshot', () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const first = new THREE.Mesh(new THREE.BufferGeometry(), material);
    const second = new THREE.Mesh(new THREE.BufferGeometry(), material);
    const root = new THREE.Group();
    root.add(first, second);
    const resources: ExportResources = { materials: [], textures: [], geometries: [] };

    snapshotOriginalMaterials(root, new Set(), resources);

    expect(first.material).toBe(second.material);
    expect(first.material).not.toBe(material);
    expect((first.material as THREE.MeshStandardMaterial).map).not.toBe(texture);
    expect(resources.materials).toHaveLength(1);
    expect(resources.textures).toHaveLength(1);

    first.geometry.dispose();
    second.geometry.dispose();
    material.dispose();
    texture.dispose();
    resources.materials.forEach((item) => item.dispose());
    resources.textures.forEach((item) => item.dispose());
  });
});
