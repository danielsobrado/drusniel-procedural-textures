import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const librarySource = readFileSync(
  new URL('../src/tile/TerrainPresetTextureLibrary.ts', import.meta.url),
  'utf8'
);

describe('terrain preset texture library', () => {
  it('loads immutable preset terrain textures without allocating GPU bake resources', () => {
    expect(librarySource).toContain('fetch(presetTerrainTextureUrl(presetId))');
    expect(librarySource).toContain('createImageBitmap(await response.blob())');
    expect(librarySource).not.toContain('MaterialCompiler');
    expect(librarySource).not.toContain('TileMaterialBaker');
  });

  it('does not retain the removed serialized bake queue', () => {
    expect(librarySource).not.toContain('bakeQueue');
    expect(librarySource).not.toContain('private bake(');
  });
});
