import { describe, expect, it } from 'vitest';
import { ImportedFileCache } from '../src/app/ImportedFileCache';

function file(name: string, bytes: number, lastModified = 1): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream', lastModified });
}

describe('ImportedFileCache', () => {
  it('evicts least-recently-used bundles by entry limit', () => {
    const cache = new ImportedFileCache(2, 1024);
    cache.remember('a.glb', [file('a.glb', 10)]);
    cache.remember('b.glb', [file('b.glb', 10)]);
    expect(cache.lookup('a.glb').status).toBe('found');
    cache.remember('c.glb', [file('c.glb', 10)]);
    expect(cache.lookup('a.glb').status).toBe('found');
    expect(cache.lookup('b.glb').status).toBe('missing');
  });

  it('rejects different assets reusing the same primary name', () => {
    const cache = new ImportedFileCache(4, 1024);
    cache.remember('asset.glb', [file('asset.glb', 10, 1)]);
    expect(() => cache.remember('asset.glb', [file('asset.glb', 11, 2)])).toThrow(/different imported asset/i);
  });

  it('evicts bundles when their retained bytes exceed the configured budget', () => {
    const cache = new ImportedFileCache(4, 15);
    cache.remember('a.glb', [file('a.glb', 10)]);
    cache.remember('b.glb', [file('b.glb', 10)]);
    expect(cache.lookup('a.glb').status).toBe('missing');
    expect(cache.lookup('b.glb').status).toBe('found');
  });
});
