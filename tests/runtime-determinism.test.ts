import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { runtimeVariantLayers } from '../src/runtime/ProceduralMaterial';

const FIXTURES = [
  'brick', 'stone', 'grass', 'biological', 'reaction-diffusion'
] as const;

describe('runtime compatibility fixtures', () => {
  it('keeps canonical recipe seed variation deterministic', async () => {
    const fingerprints: Record<string, Array<[string, number]>> = {};
    for (const name of FIXTURES) {
      const url = new URL(`./fixtures/runtime/${name}.ptl.json`, import.meta.url);
      const recipe = parseMaterialRecipe(JSON.parse(await readFile(url, 'utf8')) as unknown);
      const first = runtimeVariantLayers(recipe.layers, recipe.seed);
      const second = runtimeVariantLayers(recipe.layers, recipe.seed);
      expect(second).toEqual(first);
      fingerprints[name] = first.map((layer) => [layer.kind, layer.seed]);
    }

    expect(fingerprints).toMatchInlineSnapshot(`
      {
        "biological": [
          [
            "vessels",
            39.22296924237162,
          ],
        ],
        "brick": [
          [
            "pattern",
            47.6802062606439,
          ],
        ],
        "grass": [
          [
            "pattern",
            26.485369062051177,
          ],
        ],
        "reaction-diffusion": [
          [
            "reaction-diffusion",
            55.798615355975926,
          ],
        ],
        "stone": [
          [
            "cellular",
            74.92551815044135,
          ],
        ],
      }
    `);
  });
});
