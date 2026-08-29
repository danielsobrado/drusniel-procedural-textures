import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERRAIN_CONFIG } from '../src/config/terrainConfig';
import { MATERIAL_PRESETS } from '../src/materials/presets';

const packageDocument = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts?: Record<string, string> };
const generatorSource = readFileSync(
  new URL('../scripts/generate-terrain-preset-textures.mjs', import.meta.url),
  'utf8'
);
const publishSource = readFileSync(
  new URL('../scripts/publish-gh-pages.mjs', import.meta.url),
  'utf8'
);

describe('terrain preset texture cache', () => {
  it.each(MATERIAL_PRESETS.map((preset) => [preset.id]))(
    'contains a flat seamless PNG for %s',
    (id) => {
      const textureUrl = new URL(`../public/terrain-presets/${id}.png`, import.meta.url);
      expect(existsSync(textureUrl)).toBe(true);
      const texture = readFileSync(textureUrl);
      expect([...texture.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(texture.readUInt32BE(16)).toBe(TERRAIN_CONFIG.materials.presetBakeResolution);
      expect(texture.readUInt32BE(20)).toBe(TERRAIN_CONFIG.materials.presetBakeResolution);
    }
  );

  it('contains exactly the registered preset ids', () => {
    const actual = readdirSync(new URL('../public/terrain-presets/', import.meta.url))
      .filter((name) => name.endsWith('.png'))
      .sort();
    const expected = MATERIAL_PRESETS.map((preset) => `${preset.id}.png`).sort();
    expect(actual).toEqual(expected);
  });

  it('provides deterministic generation and pixel freshness verification', () => {
    expect(packageDocument.scripts?.['terrain-presets:generate']).toBe(
      'node scripts/generate-terrain-preset-textures.mjs'
    );
    expect(packageDocument.scripts?.['terrain-presets:check']).toBe(
      'node scripts/generate-terrain-preset-textures.mjs --check'
    );
    expect(generatorSource).toContain('window.__PTL_THUMBNAIL_GENERATOR__.renderTerrain(presetId)');
    expect(generatorSource).toContain('compareCachedPixels(page, id)');
    expect(generatorSource).toContain('getImageData(0, 0, canvas.width, canvas.height).data');
    expect(generatorSource).not.toContain('actual.equals(expected)');
    expect(generatorSource).toContain("'--use-angle=swiftshader'");
  });

  it('blocks releases and manual GitHub Pages publishing when generated terrain assets are stale', () => {
    expect(packageDocument.scripts?.['release:check']).toContain('npm run terrain-presets:check');
    expect(publishSource).toContain("execSync('npm run release:check'");
    expect(publishSource).toContain("requireCleanWorktree(root, 'before release checks')");
    expect(publishSource).toContain("requireCleanWorktree(root, 'after release checks')");
    expect(publishSource).not.toContain("execSync('npm run terrain-presets:check'");
  });
});
