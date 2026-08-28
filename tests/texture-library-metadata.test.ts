import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ktx2TextureResolver } from '../src/assets/Ktx2TextureResolver';
import { TEXTURE_LIBRARY_ASSETS } from '../src/config/textureLibraryConfig';
import { PTL_GENERATED_TEXTURE_FIELD_FAMILIES } from '../src/runtime/GeneratedTextureResolver';

describe('texture library metadata', () => {
  it('declares every scalar field channel used by authored materials', () => {
    for (const asset of TEXTURE_LIBRARY_ASSETS) {
      expect(asset.usages, asset.id).toEqual(expect.arrayContaining([
        'height',
        'mask',
        'roughness',
        'color'
      ]));
    }
  });

  it('keeps the self-contained runtime generator aligned with catalog families', () => {
    expect([...new Set(TEXTURE_LIBRARY_ASSETS.map((asset) => asset.family))].sort())
      .toEqual([...PTL_GENERATED_TEXTURE_FIELD_FAMILIES].sort());
  });

  it('loads one GPU texture for stable ids packed into the same file', async () => {
    const resolver = new Ktx2TextureResolver();
    const texture = new THREE.Texture();
    const loadFile = vi.spyOn(
      resolver as unknown as {
        loadFile(file: string, id: string): Promise<THREE.Texture>;
      },
      'loadFile'
    ).mockResolvedValue(texture);

    try {
      const [red, green] = await Promise.all([
        resolver.resolve('cracks.01'),
        resolver.resolve('cracks.02')
      ]);
      expect(loadFile).toHaveBeenCalledTimes(1);
      expect(red).toEqual({ texture, channel: 'r' });
      expect(green).toEqual({ texture, channel: 'g' });
      expect((await resolver.resolve('cracks.01'))).toBe(red);
    } finally {
      resolver.dispose();
      loadFile.mockRestore();
    }
  });
});
