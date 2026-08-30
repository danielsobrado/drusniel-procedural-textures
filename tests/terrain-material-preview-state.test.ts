import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '../src/materials/presets';
import { TerrainPresetTextureLibrary } from '../src/tile/TerrainPresetTextureLibrary';

const PREVIEW_SOURCE = readFileSync(
  new URL('../src/tile/TerrainMeshPreview.ts', import.meta.url),
  'utf8'
);
const LIBRARY_SOURCE = readFileSync(
  new URL('../src/tile/TerrainPresetTextureLibrary.ts', import.meta.url),
  'utf8'
);
const PANEL_SOURCE = readFileSync(
  new URL('../src/ui/TerrainTileLabPanel.ts', import.meta.url),
  'utf8'
);
const TINT_SOURCE = readFileSync(
  new URL('../src/ui/presetTint.ts', import.meta.url),
  'utf8'
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('terrain preset prefetch', () => {
  it('never surfaces a speculative warm-up failure to the caller', async () => {
    const library = new TerrainPresetTextureLibrary();
    const presetId = MATERIAL_PRESETS[0]!.id;
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch;

    await expect(library.prefetch(presetId)).resolves.toBeUndefined();
    // The real load on click still reports the failure through its own error path.
    await expect(library.load(presetId)).rejects.toThrow();
  });

  it('stays quiet for an unknown preset instead of throwing', async () => {
    const library = new TerrainPresetTextureLibrary();
    await expect(library.prefetch('not-a-real-preset')).resolves.toBeUndefined();
  });

  it('shares the in-flight dedup with load rather than adding a second request', () => {
    // prefetch delegates to load(), which already dedups by preset id and writes the LRU.
    expect(LIBRARY_SOURCE).toContain('public async prefetch');
    expect(LIBRARY_SOURCE).toContain('await this.load(presetId);');
  });

  it('caps the cache where hover prefetch can actually fill it', () => {
    expect(LIBRARY_SOURCE).toContain('const PRESET_CACHE_LIMIT = 12;');
  });
});

describe('terrain material preview ownership', () => {
  it('routes every texture walk that ignores the index through one iterator', () => {
    // Missing the compare/preview stashes leaks them on unmount and, worse, lets a scale
    // change apply to only one side of an A/B comparison.
    expect(PREVIEW_SOURCE).toContain('private *allTextureSets()');
    const disposeStart = PREVIEW_SOURCE.indexOf('public dispose()');
    const disposeEnd = PREVIEW_SOURCE.indexOf('private createRenderLayers', disposeStart);
    const disposeBody = PREVIEW_SOURCE.slice(disposeStart, disposeEnd);
    expect(disposeStart).toBeGreaterThanOrEqual(0);
    expect(disposeEnd).toBeGreaterThan(disposeStart);
    expect(disposeBody).toContain('this.allTextureSets()');
    expect(disposeBody).not.toContain('this.materialTextures.values()');
  });

  it('applies a scale change to the stashed sets as well as the live ones', () => {
    const start = PREVIEW_SOURCE.indexOf('private applyRepeats()');
    const end = PREVIEW_SOURCE.indexOf('private togglePlayerMode', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = PREVIEW_SOURCE.slice(start, end);
    expect(body).toContain('this.compareSets, this.previewSets');
    expect(body).toContain('texture.repeat.set(repeat, repeat)');
  });

  it('exposes preview and compare as pure swaps rather than reloads', () => {
    for (const method of [
      'public previewMaterialTextures',
      'public previewMaterialTint',
      'public restoreMaterial',
      'public toggleMaterialCompare',
      'public setMaterialTexturesRetaining',
      'public setMaterialTint'
    ]) {
      expect(PREVIEW_SOURCE).toContain(method);
    }
    const start = PREVIEW_SOURCE.indexOf('public toggleMaterialCompare');
    const end = PREVIEW_SOURCE.indexOf('public clearMaterialCompare', start);
    const body = PREVIEW_SOURCE.slice(start, end);
    // A swap must not build new GPU textures, or the comparison stops being instant.
    expect(body).not.toContain('createGpuTextureSet');
    expect(body).not.toContain('createPair');
  });

  it('keeps the outgoing assignment for comparison when a preset is applied', () => {
    expect(PANEL_SOURCE).toContain('setMaterialTexturesRetaining(terrainMaterialIndex(material), textures)');
  });

  it('cancels stale asynchronous radial previews and snapshots tint previews', () => {
    expect(PANEL_SOURCE).toContain('radialPreviewSequence');
    expect(PANEL_SOURCE).toContain('isCurrentRadialPreview(');
    expect(PREVIEW_SOURCE).toContain('public previewMaterialTint');
    const start = PREVIEW_SOURCE.indexOf('public previewMaterialTint');
    const end = PREVIEW_SOURCE.indexOf('private applyMaterialTint', start);
    expect(PREVIEW_SOURCE.slice(start, end)).toContain(
      'this.previewSets.set(materialIndex, this.takeLive(materialIndex))'
    );
  });
});

describe('preset tint stand-in', () => {
  it('samples the centre crop, because thumbnails are spheres on a dark backdrop', () => {
    expect(TINT_SOURCE).toContain('const CENTRE_CROP = 0.5;');
    expect(TINT_SOURCE).toContain('(bitmap.width - crop) / 2');
  });

  it('applies within a frame and clears itself if the bake fails', () => {
    expect(PANEL_SOURCE).toContain('cachedPresetTint(preset.id)');
    expect(PANEL_SOURCE).toContain('this.meshPreview.setMaterialTint(terrainMaterialIndex(material), null)');
  });
});
