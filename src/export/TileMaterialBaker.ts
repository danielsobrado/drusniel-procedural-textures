import * as THREE from 'three';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import {
  createOptionalWebGlRenderer,
  WEBGL2_UNAVAILABLE_MESSAGE
} from '../engine/WebGlRenderer';
import { rememberTextureSetDisplacementExtent } from './SeamlessTexture';
import { TextureBaker, type BakedTextureSet } from './TextureBaker';

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
    if (!Number.isInteger(requestedResolution) || requestedResolution < MIN_TEXTURE_SIZE) {
      throw new Error(`Tile resolution must be an integer of at least ${MIN_TEXTURE_SIZE} pixels.`);
    }
    if (!Number.isFinite(worldSize) || worldSize <= 0) {
      throw new Error('Tile world size must be greater than zero.');
    }

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
    } finally {
      geometry.dispose();
    }
  }

  public dispose(): void {
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }

  private getRenderer(): THREE.WebGLRenderer {
    if (this.renderer !== null) return this.renderer;

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

  private effectiveResolution(renderer: THREE.WebGLRenderer, requested: number): number {
    const deviceLimit = Math.max(renderer.capabilities.maxTextureSize, MIN_TEXTURE_SIZE);
    const bounded = Math.min(requested, deviceLimit, MAX_TEXTURE_SIZE);
    const powerOfTwo = 2 ** Math.floor(Math.log2(bounded));
    return Math.max(powerOfTwo, MIN_TEXTURE_SIZE);
  }
}
