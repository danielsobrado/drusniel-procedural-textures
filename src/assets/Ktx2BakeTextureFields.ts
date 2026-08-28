import * as THREE from 'three';
import type { ResolvedTextureField } from '../core/texture/ResolvedTextureField';
import type { TextureFieldChannel } from '../core/texture/TextureFieldSettings';
import { Ktx2TextureResolver } from './Ktx2TextureResolver';

const TEXTURE_CHANNEL_CODE: Record<TextureFieldChannel, number> = {
  r: 0,
  g: 1,
  b: 2,
  a: 3,
  luminance: 4
};

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}

export class Ktx2BakeTextureFields {
  private renderer: THREE.WebGLRenderer | null = null;
  private resolver = this.createResolver();
  private fields = new Map<string, ResolvedTextureField>();
  private layerIds: readonly (string | null)[] = [];
  private ids: readonly string[] = [];
  private fingerprint = '';
  private readyFingerprint = '';
  private preparation: Promise<void> | null = null;
  private preparationFingerprint = '';

  public setDependencies(
    layerIds: readonly (string | null)[],
    ids: readonly string[]
  ): void {
    this.layerIds = [...layerIds];
    const fingerprint = ids.join('|');
    if (fingerprint === this.fingerprint) return;

    this.ids = [...ids];
    this.fingerprint = fingerprint;
    this.readyFingerprint = '';
    if (ids.length === 0) this.fields.clear();
  }

  public async prepare(renderer: THREE.WebGLRenderer): Promise<void> {
    if (this.ids.length === 0) return;
    if (this.renderer !== renderer) this.setRenderer(renderer);

    while (this.ids.length > 0) {
      const fingerprint = this.fingerprint;
      if (this.readyFingerprint === fingerprint) return;

      const pending = this.preparation !== null && this.preparationFingerprint === fingerprint
        ? this.preparation
        : this.startPreparation(fingerprint, [...this.ids]);

      try {
        await pending;
      } catch (error) {
        if (this.fingerprint !== fingerprint) continue;
        throw new Error('Bake texture-field preparation failed.', {
          cause: normalizeError(error, 'KTX2 bake texture-field loading failed.')
        });
      }

      if (this.fingerprint !== fingerprint) continue;
      if (this.readyFingerprint !== fingerprint) {
        throw new Error('Bake texture fields did not reach a ready state.');
      }
      return;
    }
  }

  public apply(baseValues: readonly THREE.Texture[]): THREE.Texture[] {
    const values = [...baseValues];
    if (this.ids.length === 0 || this.readyFingerprint !== this.fingerprint) return values;

    for (let index = 0; index < values.length; index += 1) {
      const id = this.layerIds[index] ?? null;
      if (id === null) continue;
      const field = this.fields.get(id);
      if (field === undefined) throw new Error(`Bake texture field "${id}" is not prepared.`);
      values[index] = field.texture;
    }
    return values;
  }

  public applyChannels(baseValues: readonly number[]): number[] {
    const values = [...baseValues];
    if (this.ids.length === 0 || this.readyFingerprint !== this.fingerprint) return values;

    for (let index = 0; index < values.length; index += 1) {
      const id = this.layerIds[index] ?? null;
      if (id === null) continue;
      const field = this.fields.get(id);
      if (field === undefined) throw new Error(`Bake texture field "${id}" is not prepared.`);
      if (field.channel !== undefined) values[index] = TEXTURE_CHANNEL_CODE[field.channel];
    }
    return values;
  }

  public dispose(): void {
    this.renderer = null;
    this.fields.clear();
    this.layerIds = [];
    this.ids = [];
    this.fingerprint = '';
    this.readyFingerprint = '';
    this.preparation = null;
    this.preparationFingerprint = '';
    this.resolver.dispose();
  }

  private setRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.preparation !== null) {
      throw new Error('Cannot switch the KTX2 bake renderer while texture fields are loading.');
    }
    this.resolver.dispose();
    this.renderer = renderer;
    this.resolver = this.createResolver();
    this.fields.clear();
    this.readyFingerprint = '';
  }

  private createResolver(): Ktx2TextureResolver {
    const resolver = new Ktx2TextureResolver();
    resolver.setSupportRendererProvider(async () => {
      const renderer = this.renderer;
      if (renderer === null || renderer.getContext().isContextLost()) {
        throw new Error('WebGL renderer is unavailable for KTX2 bake texture fields.');
      }
      return renderer;
    });
    return resolver;
  }

  private startPreparation(
    fingerprint: string,
    ids: readonly string[]
  ): Promise<void> {
    let request: Promise<void>;
    request = this.load(ids, fingerprint)
      .finally(() => {
        this.resolver.releaseTranscoderWhenIdle();
        if (this.preparation === request) {
          this.preparation = null;
          this.preparationFingerprint = '';
        }
      });

    this.preparation = request;
    this.preparationFingerprint = fingerprint;
    return request;
  }

  private async load(ids: readonly string[], fingerprint: string): Promise<void> {
    const textures = await Promise.all(
      ids.map(async (id) => [id, await this.resolver.resolve(id)] as const)
    );
    if (fingerprint !== this.fingerprint) return;
    this.fields = new Map(textures);
    this.readyFingerprint = fingerprint;
  }
}
