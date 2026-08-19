import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { EnvironmentPreset } from '../materials/types';

export interface StudioLightProfile {
  keyColor: string;
  keyIntensity: number;
  fillColor: string;
  fillIntensity: number;
  rimColor: string;
  rimIntensity: number;
  hemisphereIntensity: number;
  environmentIntensity: number;
}

const PROFILES: Record<Exclude<EnvironmentPreset, 'custom'>, StudioLightProfile> = {
  studio: {
    keyColor: '#fff3e4',
    keyIntensity: 3.1,
    fillColor: '#b8d5ff',
    fillIntensity: 1.15,
    rimColor: '#ffb18f',
    rimIntensity: 1.35,
    hemisphereIntensity: 1.2,
    environmentIntensity: 1
  },
  warm: {
    keyColor: '#ffd9b2',
    keyIntensity: 3.4,
    fillColor: '#e5b68f',
    fillIntensity: 1.05,
    rimColor: '#ff7f66',
    rimIntensity: 1.5,
    hemisphereIntensity: 1.05,
    environmentIntensity: 1.08
  },
  cool: {
    keyColor: '#dce9ff',
    keyIntensity: 3,
    fillColor: '#83b9ff',
    fillIntensity: 1.3,
    rimColor: '#c8a8ff',
    rimIntensity: 1.2,
    hemisphereIntensity: 1.15,
    environmentIntensity: 0.95
  },
  night: {
    keyColor: '#9eb9ff',
    keyIntensity: 2.1,
    fillColor: '#526eaa',
    fillIntensity: 0.7,
    rimColor: '#d77cae',
    rimIntensity: 1.05,
    hemisphereIntensity: 0.6,
    environmentIntensity: 0.55
  }
};

export class EnvironmentLibrary {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly studioTarget: THREE.WebGLRenderTarget;
  private customTarget: THREE.WebGLRenderTarget | null = null;
  private customName: string | null = null;

  public constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.studioTarget = this.pmrem.fromScene(room, 0.04);
    room.dispose();
  }

  public hasCustomEnvironment(name: string | null): boolean {
    return name !== null && this.customTarget !== null && this.customName === name;
  }

  public apply(
    scene: THREE.Scene,
    preset: EnvironmentPreset,
    customName: string | null = null
  ): StudioLightProfile {
    if (preset === 'custom' && this.hasCustomEnvironment(customName)) {
      scene.environment = this.customTarget?.texture ?? this.studioTarget.texture;
      scene.environmentIntensity = 1;
      return PROFILES.studio;
    }

    scene.environment = this.studioTarget.texture;
    const profile = preset === 'custom' ? PROFILES.studio : PROFILES[preset];
    scene.environmentIntensity = profile.environmentIntensity;
    return profile;
  }

  public async loadHdr(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.hdr')) {
      throw new Error('Environment files must use the Radiance .hdr format.');
    }

    const url = URL.createObjectURL(file);
    try {
      const texture = await new RGBELoader().loadAsync(url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const target = this.pmrem.fromEquirectangular(texture);
      texture.dispose();
      this.customTarget?.dispose();
      this.customTarget = target;
      this.customName = file.name;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  public dispose(): void {
    this.customTarget?.dispose();
    this.customTarget = null;
    this.customName = null;
    this.studioTarget.dispose();
    this.pmrem.dispose();
  }
}
