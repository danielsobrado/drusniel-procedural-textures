import * as THREE from 'three';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { PhysicalSettings } from '../materials/types';
import { TextureBaker, type BakedTextureSet } from './TextureBaker';

const MIN_TEXTURE_SIZE = 128;
const MAX_TEXTURE_SIZE = 4096;

export class TileMaterialBaker {
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

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(1);
    renderer.setSize(1, 1, false);

    const resolution = this.effectiveResolution(renderer, requestedResolution);
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    mesh.name = 'Seamless tile sample';
    const baker = new TextureBaker(renderer, this.compiler);

    try {
      return await baker.bake(mesh, settings, resolution);
    } finally {
      geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }

  private effectiveResolution(renderer: THREE.WebGLRenderer, requested: number): number {
    const deviceLimit = Math.max(renderer.capabilities.maxTextureSize, MIN_TEXTURE_SIZE);
    const bounded = Math.min(requested, deviceLimit, MAX_TEXTURE_SIZE);
    const powerOfTwo = 2 ** Math.floor(Math.log2(bounded));
    return Math.max(powerOfTwo, MIN_TEXTURE_SIZE);
  }
}
