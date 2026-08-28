import type { Texture } from 'three';
import type { TextureFieldChannel } from './TextureFieldSettings';

/** Physical texture storage returned by a host resolver for one stable scalar-field id. */
export interface ResolvedTextureField {
  texture: Texture;
  /** Overrides the recipe channel when several stable scalar ids share one packed texture. */
  channel?: TextureFieldChannel;
}

export type TextureFieldResource = Texture | ResolvedTextureField;

export function normalizeResolvedTextureField(resource: TextureFieldResource): ResolvedTextureField {
  return 'texture' in resource ? resource : { texture: resource };
}
