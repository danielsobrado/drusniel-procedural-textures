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

  it('remaps local UVs inside the requested atlas slot with a half-texel isolation inset', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const layout = createSharedAtlasLayout(4, 512, 1024, 128);
    const remapped = remapGeometryUvToAtlas(source, 3, layout);
    const uv = remapped.getAttribute('uv');
    const inset = 0.5 / layout.resolution;

    expect(Array.from(source.getAttribute('uv').array)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(uv.getX(0)).toBeCloseTo(0.5 + inset, 6);
    expect(uv.getY(0)).toBeCloseTo(0.5 + inset, 6);
    expect(uv.getX(1)).toBeCloseTo(1 - inset, 6);
    expect(uv.getY(1)).toBeCloseTo(0.5 + inset, 6);
    expect(uv.getX(2)).toBeCloseTo(0.5 + inset, 6);
    expect(uv.getY(2)).toBeCloseTo(1 - inset, 6);

    source.dispose();
    remapped.dispose();
  });

  it('rejects slots outside the allocated atlas grid', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const layout = createSharedAtlasLayout(4, 512, 1024, 128);
    expect(() => remapGeometryUvToAtlas(source, 4, layout)).toThrow(/invalid shared-atlas/i);
    source.dispose();
  });
});
