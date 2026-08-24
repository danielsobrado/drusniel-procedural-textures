import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/materials/presets';
import { TerrainPresetTextureLibrary } from '../src/tile/TerrainPresetTextureLibrary';
import type { TerrainTextureSource } from '../src/tile/TerrainTypes';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function texture(value: number): TerrainTextureSource {
  return {
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([value, value, value, 255])
  };
}

describe('terrain preset texture library', () => {
  it('serializes bakes without letting a cleared request replace a newer request', async () => {
    const presetId = MATERIAL_PRESETS[0]?.id;
    if (presetId === undefined) throw new Error('Terrain preset test requires at least one material preset.');

    const library = new TerrainPresetTextureLibrary();
    const stale = deferred<TerrainTextureSource>();
    const active = deferred<TerrainTextureSource>();
    const requests = [stale.promise, active.promise];
    let bakeCalls = 0;

    const mutable = library as unknown as {
      bake: () => Promise<TerrainTextureSource>;
    };
    mutable.bake = () => {
      const request = requests[bakeCalls];
      bakeCalls += 1;
      if (request === undefined) throw new Error('Unexpected terrain preset bake.');
      return request;
    };

    const staleLoad = library.load(presetId);
    await Promise.resolve();
    expect(bakeCalls).toBe(1);

    library.clear();
    const activeLoad = library.load(presetId);
    await Promise.resolve();
    expect(bakeCalls).toBe(1);

    stale.resolve(texture(32));
    await staleLoad;
    await Promise.resolve();
    expect(bakeCalls).toBe(2);

    const joinedLoad = library.load(presetId);
    expect(bakeCalls).toBe(2);

    const activeTexture = texture(224);
    active.resolve(activeTexture);
    expect(await activeLoad).toBe(activeTexture);
    expect(await joinedLoad).toBe(activeTexture);
    expect(await library.load(presetId)).toBe(activeTexture);
    expect(bakeCalls).toBe(2);
  });
});
