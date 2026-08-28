import * as THREE from 'three';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import {
  createOptionalWebGlRenderer,
  WEBGL2_UNAVAILABLE_MESSAGE
} from '../engine/WebGlRenderer';
import { rememberTextureSetDisplacementExtent } from './SeamlessTexture';
import type { BakedTexture, BakedTextureSet } from './TextureBaker';

const MIN_TEXTURE_SIZE = 128;
const MAX_TEXTURE_SIZE = 4096;

export class TileMaterialBaker {
  private renderer: THREE.WebGLRenderer | null = null;

  public constructor(private readonly compiler: MaterialCompiler) {}

  public async bake(
    settings: Readonly<PhysicalSettings>,
    requestedResolution: number,
    worldSize: number
  ): Promise<BakedTextureSet> {
    this.validateRequest(requestedResolution, worldSize);
    const { TextureBaker } = await import('./TextureBaker');
    const renderer = this.getRenderer();
    const displacementExtent = this.compiler.displacementExtent;
    const resolution = this.effectiveResolution(renderer, requestedResolution);
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    mesh.name = 'Seamless tile sample';
    const baker = new TextureBaker(renderer, this.compiler);

    try {
      const textures = await baker.bake(mesh, settings, resolution);
      rememberTextureSetDisplacementExtent(textures, displacementExtent);
      return textures;
    } catch (error) {
      this.handleBakeFailure(renderer, error);
    } finally {
      geometry.dispose();
    }
  }

  public async bakeAlbedo(
    settings: Readonly<PhysicalSettings>,
    requestedResolution: number,
    worldSize: number
  ): Promise<BakedTexture> {
    this.validateRequest(requestedResolution, worldSize);
    const { TextureBaker } = await import('./TextureBaker');
    const renderer = this.getRenderer();
    const resolution = this.effectiveResolution(renderer, requestedResolution);
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    mesh.name = 'Seamless tile sample';
    const baker = new TextureBaker(renderer, this.compiler);

    try {
      return await baker.bakeAlbedo(mesh, settings, resolution);
    } catch (error) {
      this.handleBakeFailure(renderer, error);
    } finally {
      geometry.dispose();
    }
  }

  /**
   * The bake renderer, created on demand. Exposed so callers that own the compiler
   * feeding this baker can point KTX2 support detection at the same context instead
   * of allocating another one.
   */
  public acquireRenderer(): THREE.WebGLRenderer {
    return this.getRenderer();
  }

  public dispose(): void {
    const renderer = this.renderer;
    if (renderer !== null) this.releaseRenderer(renderer);
  }

  private validateRequest(requestedResolution: number, worldSize: number): void {
    if (!Number.isInteger(requestedResolution) || requestedResolution < MIN_TEXTURE_SIZE) {
      throw new Error(`Tile resolution must be an integer of at least ${MIN_TEXTURE_SIZE} pixels.`);
    }
    if (!Number.isFinite(worldSize) || worldSize <= 0) {
      throw new Error('Tile world size must be greater than zero.');
    }
  }

  private handleBakeFailure(renderer: THREE.WebGLRenderer, error: unknown): never {
    if (renderer.getContext().isContextLost()) this.releaseRenderer(renderer);
    throw error;
  }

  private getRenderer(): THREE.WebGLRenderer {
    const current = this.renderer;
    if (current !== null) {
      if (!current.getContext().isContextLost()) return current;
      this.releaseRenderer(current);
    }

    const renderer = createOptionalWebGlRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance'
    });
    if (renderer === null) throw new Error(WEBGL2_UNAVAILABLE_MESSAGE);
    renderer.setPixelRatio(1);
    renderer.setSize(1, 1, false);
    this.renderer = renderer;
    return renderer;
  }

  private releaseRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) this.renderer = null;
    renderer.dispose();
  }

  private effectiveResolution(renderer: THREE.WebGLRenderer, requested: number): number {
    const deviceLimit = Math.max(renderer.capabilities.maxTextureSize, MIN_TEXTURE_SIZE);
    const bounded = Math.min(requested, deviceLimit, MAX_TEXTURE_SIZE);
    const powerOfTwo = 2 ** Math.floor(Math.log2(bounded));
    return Math.max(powerOfTwo, MIN_TEXTURE_SIZE);
  }
}
