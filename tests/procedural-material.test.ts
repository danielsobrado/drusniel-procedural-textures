import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject } from '../src/app/AppState';
import { createMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { ProceduralMaterial } from '../src/runtime/ProceduralMaterial';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('procedural material runtime', () => {
  it('skips compute initialization when the recipe has no simulation layers', async () => {
    const requestAdapter = vi.fn(async () => null);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    const material = new ProceduralMaterial(createMaterialRecipe(createDefaultProject()));

    try {
      await material.prepare();
      expect(requestAdapter).not.toHaveBeenCalled();
    } finally {
      material.dispose();
    }
  });
});
