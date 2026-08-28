import type { Texture } from 'three';
import type { TextureFieldResource } from '../core/texture/ResolvedTextureField';

/** Host-owned resolver for external texture dependencies referenced by Material Recipes. */
export interface TextureResolver {
  resolve(id: string): Promise<TextureFieldResource>;
  release?(id: string, texture: Texture): void;
}
