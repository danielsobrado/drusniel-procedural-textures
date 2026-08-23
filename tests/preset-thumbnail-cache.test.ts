import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPORT_CONFIG } from '../src/app/constants';
import { MATERIAL_PRESETS } from '../src/materials/presets';

const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('../src/ui/LibraryPanel.ts', import.meta.url), 'utf8');
const packageDocument = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts?: Record<string, string> };

describe('preset thumbnail cache', () => {
  it.each(MATERIAL_PRESETS.map((preset) => [preset.id]))(
    'contains a cached PNG for %s',
    (id) => {
      const thumbnailUrl = new URL(`../public/thumbnails/presets/${id}.png`, import.meta.url);
      expect(existsSync(thumbnailUrl)).toBe(true);
      const thumbnail = readFileSync(thumbnailUrl);
      expect([...thumbnail.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(thumbnail.readUInt32BE(16)).toBe(EXPORT_CONFIG.thumbnailSize);
      expect(thumbnail.readUInt32BE(20)).toBe(EXPORT_CONFIG.thumbnailSize);
    }
  );

  it('loads cached thumbnails without a runtime GPU generation queue', () => {
    expect(librarySource).toContain('presetThumbnailUrl(preset.id)');
    expect(librarySource).toContain('loading="lazy"');
    expect(appSource).not.toContain('queuePresetThumbnail');
    expect(appSource).not.toContain('generatePresetThumbnail');
  });

  it('provides a local missing-thumbnail generator', () => {
    expect(packageDocument.scripts?.['thumbnails:generate']).toBe(
      'node scripts/generate-preset-thumbnails.mjs'
    );
    expect(existsSync(new URL('../scripts/generate-preset-thumbnails.mjs', import.meta.url))).toBe(true);
  });
});
