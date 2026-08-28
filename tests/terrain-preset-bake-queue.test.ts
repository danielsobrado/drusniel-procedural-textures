import { describe, expect, it } from 'vitest';
import {
  TerrainPresetBakeCancelled,
  TerrainPresetTextureLibrary
} from '../src/tile/TerrainPresetTextureLibrary';
import type { TerrainTextureSource } from '../src/tile/TerrainTypes';

function stubTexture(): TerrainTextureSource {
  return { width: 1, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255]) };
}

/** Replaces the GPU bake with a counting stub so the queue policy can be tested on its own. */
function instrument(library: TerrainPresetTextureLibrary): { baked: string[] } {
  const baked: string[] = [];
  const target = library as unknown as {
    bake: (preset: { id: string }, entry: unknown) => Promise<TerrainTextureSource>;
  };
  target.bake = async (preset) => {
    baked.push(preset.id);
    await Promise.resolve();
    return stubTexture();
  };
  return { baked };
}

// The baked-pixel cache is module-level and lives for the page by design, so cases cannot rely
// on per-instance isolation. Each one draws ids no other case has used.
const IDS = [
  'alpine-scree', 'bog-moss', 'coastal-sand',
  'coastal-dune-grass', 'adipose-v8', 'alien-dermis',
  'texture-field-cracks', 'texture-field-craters', 'texture-field-crystal',
  'texture-field-gabor', 'texture-field-grainy', 'texture-field-manifold'
];
let nextId = 0;
const freshId = (): string => {
  const id = IDS[nextId];
  nextId += 1;
  if (id === undefined) throw new Error('Ran out of distinct preset ids for the queue tests.');
  return id;
};

describe('terrain preset bake queue', () => {
  it('drops a queued bake whose slot already moved on', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { baked } = instrument(library);
    const stale = freshId();
    const wanted = freshId();

    const dropped = library.load(stale, { isCurrent: () => false });
    const kept = library.load(wanted, { isCurrent: () => true });

    await expect(dropped).rejects.toBeInstanceOf(TerrainPresetBakeCancelled);
    await expect(kept).resolves.toMatchObject({ width: 1 });
    expect(baked).toEqual([wanted]);
  });

  it('bakes once for a burst where only the last pick is still current', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { baked } = instrument(library);
    const first = freshId();
    const second = freshId();
    const third = freshId();

    let current = first;
    const pick = (id: string): Promise<unknown> => {
      current = id;
      return library.load(id, { isCurrent: () => current === id }).catch(() => null);
    };

    await Promise.all([pick(first), pick(second), pick(third)]);

    expect(baked).toEqual([third]);
  });

  it('keeps a bake alive while any waiter still wants it', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { baked } = instrument(library);
    const shared = freshId();

    const dropped = library.load(shared, { isCurrent: () => false });
    const kept = library.load(shared, { isCurrent: () => true });

    await expect(kept).resolves.toMatchObject({ width: 1 });
    await expect(dropped).resolves.toMatchObject({ width: 1 });
    expect(baked).toEqual([shared]);
  });

  it('serves a cached texture without re-baking and still reports completion', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { baked } = instrument(library);
    const id = freshId();

    await library.load(id, { isCurrent: () => true });
    const phases: [string, number][] = [];
    await library.load(id, {
      isCurrent: () => true,
      onProgress: (phase, fraction) => phases.push([phase, fraction])
    });

    expect(baked).toEqual([id]);
    expect(phases).toEqual([['Ready', 1]]);
  });

  it('reuses the cache across library instances so reopening the panel does not re-bake', async () => {
    const id = freshId();
    const first = new TerrainPresetTextureLibrary();
    const firstCalls = instrument(first);
    await first.load(id, { isCurrent: () => true });
    first.clear();

    const second = new TerrainPresetTextureLibrary();
    const secondCalls = instrument(second);
    await expect(second.load(id, { isCurrent: () => true })).resolves.toMatchObject({ width: 1 });

    expect(firstCalls.baked).toEqual([id]);
    expect(secondCalls.baked).toEqual([]);
  });

  it('reports queue depth so a waiting slot can say why it is idle', async () => {
    const library = new TerrainPresetTextureLibrary();
    instrument(library);
    const ahead = freshId();
    const waiting = freshId();

    const seen: string[] = [];
    const first = library.load(ahead, { isCurrent: () => true });
    const second = library.load(waiting, {
      isCurrent: () => true,
      onProgress: (phase) => seen.push(phase)
    });

    await Promise.all([first, second]);
    expect(seen[0]).toBe('Queued behind 1 bake');
  });
});
