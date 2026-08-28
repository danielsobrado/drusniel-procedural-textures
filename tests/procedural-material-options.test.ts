import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/app/AppState';
import { GeneratedTextureResolver } from '../src/runtime/GeneratedTextureResolver';
import { createMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { ProceduralMaterial } from '../src/runtime/ProceduralMaterial';

describe('ProceduralMaterial options', () => {
  it('rejects invalid runtime options before constructing a material backend', () => {
    const recipe = createMaterialRecipe(createDefaultProject());

    expect(() => new ProceduralMaterial(recipe, { backend: 'invalid' as never }))
      .toThrow(/unsupported procedural material backend/iu);
    expect(() => new ProceduralMaterial(recipe, { coordinateSpace: 'uv' as never }))
      .toThrow(/unsupported material coordinate space/iu);
    expect(() => new ProceduralMaterial(recipe, { wireframe: 'true' as never }))
      .toThrow(/wireframe must be a boolean/iu);
    expect(() => new ProceduralMaterial(recipe, { textureFieldSource: 'bundled' as never }))
      .toThrow(/unsupported texture-field source/iu);
    expect(() => new ProceduralMaterial(recipe, {
      textureFieldSource: 'generated',
      generatedTextureFields: { resolution: 100 }
    })).toThrow(/power of two/iu);
    expect(() => new ProceduralMaterial(recipe, {
      textureFieldSource: 'generated',
      textureResolver: { resolve: async () => { throw new Error('unused'); } }
    })).toThrow(/cannot be combined/iu);
    expect(() => new ProceduralMaterial(recipe, {
      textureResolver: { resolve: true } as never
    })).toThrow(/texture resolver.*resolve/iu);
  });

  it('reports a caller-managed generated resolver as a generated source', () => {
    const recipe = createMaterialRecipe(createDefaultProject());
    const resolver = new GeneratedTextureResolver({ resolution: 32 });
    const runtime = new ProceduralMaterial(recipe, { textureResolver: resolver });
    try {
      expect(runtime.textureFieldSource).toBe('generated');
    } finally {
      runtime.dispose();
      resolver.dispose();
    }
  });
});
