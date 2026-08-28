import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PANEL_SOURCE = readFileSync(
  new URL('../src/ui/TerrainTileLabPanel.ts', import.meta.url),
  'utf8'
);
const COMPOSER_SOURCE = readFileSync(
  new URL('../src/tile/TerrainSurfaceComposer.ts', import.meta.url),
  'utf8'
);

describe('terrain material repeat preview', () => {
  it('routes repeat view to the currently selected material', () => {
    expect(PANEL_SOURCE).toContain('<option value="repeat">3 × 3 material</option>');
    expect(PANEL_SOURCE).toContain('this.composer.renderMaterialRepeatPreview(');
    expect(PANEL_SOURCE).toContain('terrainMaterialIndex(this.selectedMaterial)');
  });

  it('does not repeat the composed terrain map', () => {
    expect(COMPOSER_SOURCE).not.toContain("view === 'repeat' ? 3 : 1");
    expect(COMPOSER_SOURCE).toContain('const REPEAT_PREVIEW_TILES = 3;');
  });

  it('keeps the repeat renderer independent from terrain fields and paint masks', () => {
    const start = COMPOSER_SOURCE.indexOf('public renderMaterialRepeatPreview');
    const end = COMPOSER_SOURCE.indexOf('public createMaterialCanvas', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const method = COMPOSER_SOURCE.slice(start, end);

    expect(method).toContain('this.textures.get(materialIndex)');
    expect(method).not.toContain('fields.');
    expect(method).not.toContain('paint.');
  });
});
