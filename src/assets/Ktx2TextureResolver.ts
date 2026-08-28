import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import {
  textureLibraryAsset,
  textureLibraryAssetUrl,
  textureLibraryTranscoderUrl
} from '../config/textureLibraryConfig';
import type { ResolvedTextureField } from '../core/texture/ResolvedTextureField';
import type { TextureResolver } from '../runtime/TextureResolver';
import { RUNTIME_TEXTURE_FIELD_CONFIG } from '../core/material/generated/runtimeConfig';

export type Ktx2SupportRenderer = THREE.WebGLRenderer | WebGPURenderer;
export type Ktx2SupportRendererProvider = () => Promise<Ktx2SupportRenderer>;

/**
 * A transcoder that fails to initialize normally keeps failing: the Basis assets are missing or
 * blocked, or the device cannot transcode at all. Retrying per texture field would re-fetch the
 * transcoder pair (~570 KB) and rebuild a KTX2Loader for every field of every preset, so the
 * failure is remembered and replayed for a short window. The window stays short so a genuinely
 * transient outage still recovers on the next thing the user does.
 */
const TRANSCODER_RETRY_COOLDOWN_MS = 30_000;

export class Ktx2TextureResolver implements TextureResolver {
  private readonly cache = new Map<string, Promise<ResolvedTextureField>>();
  private readonly fileCache = new Map<string, Promise<THREE.Texture>>();
  private readonly loaded = new Map<string, THREE.Texture>();
  private supportRendererProvider: Ktx2SupportRendererProvider | null = null;
  private loader: KTX2Loader | null = null;
  private loaderPromise: Promise<KTX2Loader> | null = null;
  private activeLoads = 0;
  private releaseLoaderOnIdle = false;
  private transcoderFailure: { error: Error; at: number } | null = null;
  private textureAnisotropy = 1;
  private disposed = false;

  public setSupportRendererProvider(provider: Ktx2SupportRendererProvider): void {
    if (this.disposed) throw new Error('Texture resolver has been disposed.');
    if (this.loader !== null || this.loaderPromise !== null) {
      throw new Error('KTX2 support renderer must be configured before texture loading starts.');
    }
    this.supportRendererProvider = provider;
  }

  public resolve(id: string): Promise<ResolvedTextureField> {
    if (this.disposed) return Promise.reject(new Error('Texture resolver has been disposed.'));
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;

    const request = this.load(id).catch((error: unknown) => {
      this.cache.delete(id);
      throw error;
    });
    this.cache.set(id, request);
    return request;
  }

  public release(): void {
    // The Lab keeps texture fields cached across material edits. Ownership ends at dispose().
  }

  public releaseTranscoderWhenIdle(): void {
    if (this.disposed) return;
    this.releaseLoaderOnIdle = true;
    this.releaseLoaderIfIdle();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseLoaderOnIdle = false;
    this.transcoderFailure = null;
    for (const texture of this.loaded.values()) texture.dispose();
    this.loaded.clear();
    this.cache.clear();
    this.fileCache.clear();
    this.disposeLoader();
    this.loaderPromise = null;
    this.supportRendererProvider = null;
  }

  private async load(id: string): Promise<ResolvedTextureField> {
    const asset = textureLibraryAsset(id);
    const cached = this.fileCache.get(asset.file);
    const texture = cached ?? this.loadFile(asset.file, id);
    if (cached === undefined) {
      this.fileCache.set(asset.file, texture);
      void texture.catch(() => this.fileCache.delete(asset.file));
    }
    return { texture: await texture, channel: asset.channel };
  }

  private async loadFile(file: string, id: string): Promise<THREE.Texture> {
    this.activeLoads += 1;
    try {
      const loader = await this.getLoader();
      if (this.disposed) throw new Error('Texture resolver was disposed before texture loading started.');
      const texture = await loader.loadAsync(textureLibraryAssetUrl(id));
      if (this.disposed) {
        texture.dispose();
        throw new Error('Texture resolver was disposed while loading a texture field.');
      }
      texture.name = `PTL Packed Texture Fields ${file}`;
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = this.textureAnisotropy;
      texture.needsUpdate = true;
      this.loaded.set(file, texture);
      return texture;
    } finally {
      this.activeLoads = Math.max(0, this.activeLoads - 1);
      this.releaseLoaderIfIdle();
    }
  }

  private async getLoader(): Promise<KTX2Loader> {
    if (this.loader !== null) return this.loader;
    if (this.loaderPromise !== null) return this.loaderPromise;

    const initialization = this.initializeLoader();
    this.loaderPromise = initialization;
    try {
      return await initialization;
    } finally {
      if (this.loaderPromise === initialization) this.loaderPromise = null;
      this.releaseLoaderIfIdle();
    }
  }

  private async initializeLoader(): Promise<KTX2Loader> {
    const provider = this.supportRendererProvider;
    if (provider === null) {
      throw new Error('KTX2 texture-field support renderer has not been configured.');
    }

    const failure = this.transcoderFailure;
    if (failure !== null) {
      if (Date.now() - failure.at < TRANSCODER_RETRY_COOLDOWN_MS) throw failure.error;
      this.transcoderFailure = null;
    }

    const renderer = await provider();
    if (this.disposed) throw new Error('Texture resolver was disposed before KTX2 initialization completed.');
    const anisotropyRenderer = renderer as unknown as {
      getMaxAnisotropy?: () => number;
      capabilities?: { getMaxAnisotropy?: () => number };
    };
    const reportedMaximum = anisotropyRenderer.getMaxAnisotropy?.()
      ?? anisotropyRenderer.capabilities?.getMaxAnisotropy?.()
      ?? 1;
    const deviceMaximum = Number.isFinite(reportedMaximum) ? Math.max(1, reportedMaximum) : 1;
    this.textureAnisotropy = Math.max(
      1,
      Math.min(deviceMaximum, RUNTIME_TEXTURE_FIELD_CONFIG.sampling.maxAnisotropy)
    );

    const loader = new KTX2Loader().setTranscoderPath(textureLibraryTranscoderUrl());
    try {
      loader.detectSupport(renderer);
    } catch (error) {
      throw new Error('Could not detect KTX2 texture-field support.', { cause: error });
    }

    try {
      await loader.init();
      this.transcoderFailure = null;
    } catch (error) {
      loader.dispose();
      const failure = new Error('Could not initialize the KTX2 texture-field transcoder.', { cause: error });
      this.transcoderFailure = { error: failure, at: Date.now() };
      throw failure;
    }

    if (this.disposed) {
      loader.dispose();
      throw new Error('Texture resolver was disposed during KTX2 initialization.');
    }
    this.loader = loader;
    return loader;
  }

  private releaseLoaderIfIdle(): void {
    if (!this.releaseLoaderOnIdle || this.activeLoads > 0 || this.loaderPromise !== null) return;
    this.releaseLoaderOnIdle = false;
    this.disposeLoader();
  }

  private disposeLoader(): void {
    const loader = this.loader;
    this.loader = null;
    loader?.dispose();
  }
}
