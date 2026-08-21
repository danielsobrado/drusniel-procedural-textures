import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSharedAtlasLayout, remapGeometryUvToAtlas } from '../src/export/TextureAtlas';

describe('shared texture atlas', () => {
  it('uses a power-of-two grid within the export texture limit', () => {
    expect(createSharedAtlasLayout(3, 1024, 2048, 128)).toEqual({
      grid: 2,
      tileSize: 1024,
      resolution: 2048
    });
    expect(createSharedAtlasLayout(5, 1024, 2048, 128)).toEqual({
      grid: 4,
      tileSize: 512,
      resolution: 2048
    });
  });

  it('rejects atlas layouts that would destroy useful material resolution', () => {
    expect(() => createSharedAtlasLayout(200, 512, 1024, 128)).toThrow(/below 128 px/i);
  });

  it('remaps local UVs into the requested atlas slot without changing source geometry', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const remapped = remapGeometryUvToAtlas(source, 3, 2);
    expect(Array.from(source.getAttribute('uv').array)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(Array.from(remapped.getAttribute('uv').array)).toEqual([0.5, 0.5, 1, 0.5, 0.5, 1]);
    source.dispose();
    remapped.dispose();
  });
});
