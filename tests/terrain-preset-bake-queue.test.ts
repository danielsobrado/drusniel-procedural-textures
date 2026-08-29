import { describe, expect, it } from 'vitest';
import {
  TerrainPresetBakeCancelled,
  TerrainPresetTextureLibrary
} from '../src/tile/TerrainPresetTextureLibrary';
import type { TerrainTextureSource } from '../src/tile/TerrainTypes';

function stubTexture(): TerrainTextureSource {
  return { width: 1, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255]) };
}

interface PendingEntry {
  waiters: (() => boolean)[];
}

function instrument(library: TerrainPresetTextureLibrary): { loaded: string[] } {
  const loaded: string[] = [];
  const target = library as unknown as {
    loadPreset: (preset: { id: string }, entry: PendingEntry) => Promise<TerrainTextureSource>;
  };
  target.loadPreset = async (preset, entry) => {
    if (!entry.waiters.some((isCurrent) => isCurrent())) {
      throw new TerrainPresetBakeCancelled(preset.id);
    }
    loaded.push(preset.id);
    await Promise.resolve();
    if (!entry.waiters.some((isCurrent) => isCurrent())) {
      throw new TerrainPresetBakeCancelled(preset.id);
    }
    return stubTexture();
  };
  return { loaded };
}

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
  if (id === undefined) throw new Error('Ran out of distinct preset ids for the loading tests.');
  return id;
};

describe('terrain preset texture loading', () => {
  it('drops a request whose slot already moved on', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { loaded } = instrument(library);
    const stale = freshId();
    const wanted = freshId();

    const dropped = library.load(stale, { isCurrent: () => false });
    const kept = library.load(wanted, { isCurrent: () => true });

    await expect(dropped).rejects.toBeInstanceOf(TerrainPresetBakeCancelled);
    await expect(kept).resolves.toMatchObject({ width: 1 });
    expect(loaded).toEqual([wanted]);
  });

  it('starts independent preset loads without a global serialization queue', async () => {
    const library = new TerrainPresetTextureLibrary();
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const target = library as unknown as {
      loadPreset: (preset: { id: string }) => Promise<TerrainTextureSource>;
    };
    target.loadPreset = async (preset) => {
      started.push(preset.id);
      await new Promise<void>((resolve) => releases.set(preset.id, resolve));
      return stubTexture();
    };

    const firstId = freshId();
    const secondId = freshId();
    const first = library.load(firstId);
    const second = library.load(secondId);
    await Promise.resolve();

    expect(started).toEqual([firstId, secondId]);
    releases.get(firstId)?.();
    releases.get(secondId)?.();
    await Promise.all([first, second]);
  });

  it('deduplicates concurrent requests for the same preset', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { loaded } = instrument(library);
    const shared = freshId();

    const first = library.load(shared, { isCurrent: () => true });
    const second = library.load(shared, { isCurrent: () => true });

    await expect(first).resolves.toMatchObject({ width: 1 });
    await expect(second).resolves.toMatchObject({ width: 1 });
    expect(loaded).toEqual([shared]);
  });

  it('keeps a shared load alive while any waiter still wants it', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { loaded } = instrument(library);
    const shared = freshId();

    const stale = library.load(shared, { isCurrent: () => false });
    const kept = library.load(shared, { isCurrent: () => true });

    await expect(kept).resolves.toMatchObject({ width: 1 });
    await expect(stale).resolves.toMatchObject({ width: 1 });
    expect(loaded).toEqual([shared]);
  });

  it('serves cached pixels without reloading and still reports completion', async () => {
    const library = new TerrainPresetTextureLibrary();
    const { loaded } = instrument(library);
    const id = freshId();

    await library.load(id, { isCurrent: () => true });
    const phases: [string, number][] = [];
    await library.load(id, {
      isCurrent: () => true,
      onProgress: (phase, fraction) => phases.push([phase, fraction])
    });

    expect(loaded).toEqual([id]);
    expect(phases).toEqual([['Ready', 1]]);
  });

  it('reuses the cache across library instances', async () => {
    const id = freshId();
    const first = new TerrainPresetTextureLibrary();
    const firstCalls = instrument(first);
    await first.load(id, { isCurrent: () => true });
    first.clear();

    const second = new TerrainPresetTextureLibrary();
    const secondCalls = instrument(second);
    await expect(second.load(id, { isCurrent: () => true })).resolves.toMatchObject({ width: 1 });

    expect(firstCalls.loaded).toEqual([id]);
    expect(secondCalls.loaded).toEqual([]);
  });
});
