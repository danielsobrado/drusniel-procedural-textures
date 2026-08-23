import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyStaticDisplacement,
  createSharedAtlasLayout,
  remapGeometryUvToAtlas
} from '../src/export/TextureAtlas';

function solidHeight(red: number): { canvas: HTMLCanvasElement; blob: Blob } {
  const image = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([red, red, red, 255])
  } as ImageData;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({ getImageData: () => image })
  } as unknown as HTMLCanvasElement;
  return { canvas, blob: new Blob() };
}

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

  it('rejects invalid atlas dimension inputs', () => {
    expect(() => createSharedAtlasLayout(0, 512, 2048, 128)).toThrow(/target count/i);
    expect(() => createSharedAtlasLayout(1, Number.NaN, 2048, 128)).toThrow(/requested.*tile size/i);
    expect(() => createSharedAtlasLayout(1, 512, 0, 128)).toThrow(/maximum texture size/i);
    expect(() => createSharedAtlasLayout(1, 512, 2048, 0)).toThrow(/minimum tile size/i);
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

  it('preserves authored displacement direction under mirrored transforms', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    source.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1
    ], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([
      0.5, 0.5,
      0.5, 0.5,
      0.5, 0.5
    ], 2));
    source.setIndex([0, 1, 2]);

    const displaced = applyStaticDisplacement(
      source,
      solidHeight(255),
      new THREE.Matrix4().makeScale(-1, 1, 1),
      0.2
    );
    const position = displaced.getAttribute('position');

    expect(position.getZ(0)).toBeGreaterThan(0);
    expect(position.getZ(1)).toBeGreaterThan(0);
    expect(position.getZ(2)).toBeGreaterThan(0);

    source.dispose();
    displaced.dispose();
  });

  it('rejects singular transforms before attempting displacement', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    source.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1
    ], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([
      0.5, 0.5,
      0.5, 0.5,
      0.5, 0.5
    ], 2));
    source.setIndex([0, 1, 2]);

    try {
      expect(() => applyStaticDisplacement(
        source,
        solidHeight(255),
        new THREE.Matrix4().makeScale(1, 0, 1),
        0.2
      )).toThrow(/singular world transform/iu);
    } finally {
      source.dispose();
    }
  });

  it('rejects slots outside the allocated atlas grid', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    source.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const layout = createSharedAtlasLayout(4, 512, 1024, 128);
    expect(() => remapGeometryUvToAtlas(source, 4, layout)).toThrow(/invalid shared-atlas/i);
    expect(() => remapGeometryUvToAtlas(source, 0, { ...layout, resolution: 999 })).toThrow(/resolution must equal/i);
    source.dispose();
  });
});
