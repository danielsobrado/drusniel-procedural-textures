import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GeneratedTextureResolver,
  PTL_GENERATED_TEXTURE_FIELD_FAMILIES,
  PTL_GENERATED_TEXTURE_FIELD_VERSION
} from '../src/runtime/GeneratedTextureResolver';

function pixels(texture: THREE.Texture): Uint8Array {
  const data = (texture as THREE.DataTexture<Uint8Array>).image.data;
  if (!(data instanceof Uint8Array)) throw new Error('Generated texture does not contain byte data.');
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeneratedTextureResolver', () => {
  it('generates stable, distinct, periodic scalar fields without external assets', async () => {
    const resolution = 256;
    const firstResolver = new GeneratedTextureResolver();
    const secondResolver = new GeneratedTextureResolver();
    try {
      const first = await firstResolver.resolve('perlin.01');
      const repeated = await secondResolver.resolve('perlin.01');
      const different = await secondResolver.resolve('perlin.02');
      expect(first.channel).toBe('r');
      expect(PTL_GENERATED_TEXTURE_FIELD_VERSION).toBe(1);
      expect(first.texture.name).toContain('Generated Field v1');
      expect(first.texture.colorSpace).toBe(THREE.NoColorSpace);
      expect(first.texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(first.texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(pixels(first.texture)).toEqual(pixels(repeated.texture));
      expect(pixels(first.texture)).not.toEqual(pixels(different.texture));

      const data = pixels(first.texture);
      let edgeDelta = 0;
      for (let index = 0; index < resolution; index += 1) {
        edgeDelta += Math.abs(data[index * resolution]! - data[index * resolution + resolution - 1]!);
        edgeDelta += Math.abs(data[index]! - data[(resolution - 1) * resolution + index]!);
      }
      expect(edgeDelta / (resolution * 2)).toBeLessThan(18);
    } finally {
      firstResolver.dispose();
      secondResolver.dispose();
    }
  });

  it('keeps every generated catalog family continuous across repeat boundaries', async () => {
    const resolution = 64;
    const resolver = new GeneratedTextureResolver({ resolution });
    try {
      for (const family of PTL_GENERATED_TEXTURE_FIELD_FAMILIES) {
        const binding = await resolver.resolve(`${family}.01`);
        const data = pixels(binding.texture);
        let edgeDelta = 0;
        for (let index = 0; index < resolution; index += 1) {
          edgeDelta += Math.abs(data[index * resolution]! - data[index * resolution + resolution - 1]!);
          edgeDelta += Math.abs(data[index]! - data[(resolution - 1) * resolution + index]!);
        }
        expect(edgeDelta / (resolution * 2), family).toBeLessThan(36);
        resolver.release(`${family}.01`, binding.texture);
      }
    } finally {
      resolver.dispose();
    }
  });

  it('reference-counts concurrent requests for the same generated texture', async () => {
    const resolver = new GeneratedTextureResolver({ resolution: 32 });
    const [first, second] = await Promise.all([
      resolver.resolve('cracks.01'),
      resolver.resolve('cracks.01')
    ]);
    let disposals = 0;
    first.texture.addEventListener('dispose', () => { disposals += 1; });

    expect(second).toBe(first);
    resolver.release('cracks.01', first.texture);
    expect(disposals).toBe(0);
    resolver.release('cracks.01', second.texture);
    expect(disposals).toBe(1);
    resolver.dispose();
  });

  it('yields during generated texture work instead of blocking one task', async () => {
    let now = 0;
    const yieldTask = vi.fn(async () => undefined);
    vi.stubGlobal('performance', { now: () => {
      now += 3;
      return now;
    } });
    vi.stubGlobal('scheduler', { yield: yieldTask });
    const resolver = new GeneratedTextureResolver({ resolution: 64 });
    try {
      await resolver.resolve('perlin.01');
      expect(yieldTask).toHaveBeenCalled();
    } finally {
      resolver.dispose();
    }
  });

  it('rejects unsafe ids and invalid generation resolutions', async () => {
    expect(() => new GeneratedTextureResolver({ resolution: 100 })).toThrow(/power of two/iu);
    expect(() => new GeneratedTextureResolver({ allowUnknownFamilies: 'yes' as never }))
      .toThrow(/must be a boolean/iu);
    const resolver = new GeneratedTextureResolver({ resolution: 32 });
    try {
      await expect(resolver.resolve('../field')).rejects.toThrow(/invalid generated/iu);
      await expect(resolver.resolve('custom-image.01')).rejects.toThrow(/not built in/iu);
    } finally {
      resolver.dispose();
    }
  });

  it('keeps resolver failures asynchronous after disposal', async () => {
    const resolver = new GeneratedTextureResolver({ resolution: 32 });
    resolver.dispose();
    await expect(resolver.resolve('perlin.01')).rejects.toThrow(/disposed/iu);
  });

  it('requires an explicit opt-in before approximating unknown custom families', async () => {
    const resolver = new GeneratedTextureResolver({
      resolution: 32,
      allowUnknownFamilies: true
    });
    try {
      await expect(resolver.resolve('custom-image.01')).resolves.toEqual(expect.objectContaining({
        channel: 'r'
      }));
    } finally {
      resolver.dispose();
    }
  });
});
