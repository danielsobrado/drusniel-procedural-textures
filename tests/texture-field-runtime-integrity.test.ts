import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/app/AppState';
import { DEFAULT_TEXTURE_FIELD_SETTINGS } from '../src/core/texture/TextureFieldSettings';
import { createMaterialRecipe, parseMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { ProceduralMaterial } from '../src/runtime/ProceduralMaterial';

function projectWithTextureFields() {
  const project = createDefaultProject();
  const first = project.layers[0];
  const second = project.layers[1];
  if (first === undefined || second === undefined) throw new Error('Texture runtime test layers are missing.');
  first.enabled = true;
  first.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.01' };
  second.enabled = true;
  second.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.02' };
  return project;
}

describe('texture-field runtime integrity', () => {
  it('rejects dependency metadata that does not match material layer references', () => {
    const recipe = createMaterialRecipe(projectWithTextureFields());
    expect(() => parseMaterialRecipe({
      ...recipe,
      dependencies: {
        textures: [
          { id: 'perlin.01', version: 1 },
          { id: 'perlin.02', version: 1 },
          { id: 'unused.01', version: 1 }
        ]
      }
    })).toThrow(/unused\.01.*not referenced/iu);

    expect(() => parseMaterialRecipe({
      ...recipe,
      dependencies: {
        textures: [
          { id: 'perlin.01', version: 1 },
          { id: 'perlin.01', version: 1 }
        ]
      }
    })).toThrow(/perlin\.01.*more than once/iu);
  });

  it('resolves disabled texture layers used as field sources', async () => {
    const project = createDefaultProject();
    const source = project.layers[0];
    const visible = project.layers[1];
    if (source === undefined || visible === undefined) throw new Error('Texture dependency test layers are missing.');
    source.enabled = false;
    source.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'organic.02' };
    visible.enabled = true;
    visible.maskSourceLayerId = source.id;

    const texture = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
    const resolved: string[] = [];
    const runtime = new ProceduralMaterial(createMaterialRecipe(project), {
      textureResolver: {
        resolve: async (id) => {
          resolved.push(id);
          return texture;
        }
      }
    });

    try {
      await runtime.prepare();
      expect(resolved).toEqual(['organic.02']);
    } finally {
      runtime.dispose();
      texture.dispose();
    }
  });

  it('releases successful acquisitions when another texture dependency fails', async () => {
    const texture = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
    const released: string[] = [];
    const runtime = new ProceduralMaterial(createMaterialRecipe(projectWithTextureFields()), {
      textureResolver: {
        resolve: async (id) => {
          if (id === 'perlin.01') throw new Error('Expected texture load failure.');
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          return texture;
        },
        release: (id, releasedTexture) => {
          expect(releasedTexture).toBe(texture);
          released.push(id);
        }
      }
    });

    try {
      await expect(runtime.prepare()).rejects.toThrow(/expected texture load failure/iu);
      expect(released).toEqual(['perlin.02']);
    } finally {
      runtime.dispose();
      texture.dispose();
    }
  });

  it('rejects resolver results that are not Three.js textures', async () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.01' };
    const runtime = new ProceduralMaterial(createMaterialRecipe(project), {
      textureResolver: {
        resolve: async () => ({}) as THREE.Texture
      }
    });

    try {
      await expect(runtime.prepare()).rejects.toThrow(/invalid texture.*perlin\.01/iu);
    } finally {
      runtime.dispose();
    }
  });
});
