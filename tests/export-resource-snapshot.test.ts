import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cloneMaterialSet, type ExportResources } from '../src/export/ExportResourceSnapshot';

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
});
