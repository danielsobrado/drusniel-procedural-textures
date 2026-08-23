import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MAX_MODEL_FILE_BYTES } from '../app/constants';
import type { EnvironmentPreset } from '../materials/types';

const BYTES_PER_MIB = 1024 * 1024;

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
  private studioTarget: THREE.RenderTarget | null = null;
  private studioPrepared = false;
  private customTarget: THREE.RenderTarget | null = null;
  private customName: string | null = null;
  private loadSequence = 0;
  private disposed = false;

  public constructor(private readonly renderer: THREE.WebGPURenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  public get studioReady(): boolean {
    return this.studioPrepared;
  }

  public async prepareStudio(): Promise<void> {
    if (this.disposed || this.studioPrepared) return;
    await this.renderer.init();
    if (this.disposed || this.studioPrepared) return;

    const room = new RoomEnvironment();
    try {
      const target = this.pmrem.fromScene(room, 0.04);
      if (this.disposed) {
        target.dispose();
        return;
      }
      this.studioTarget?.dispose();
      this.studioTarget = target;
      this.studioPrepared = true;
    } finally {
      room.dispose();
    }
  }

  public hasCustomEnvironment(name: string | null): boolean {
    return name !== null && this.customTarget !== null && this.customName === name;
  }

  public clearCustomEnvironment(name: string | null = null): boolean {
    if (name !== null && !this.hasCustomEnvironment(name)) return false;
    if (this.customTarget === null) return false;

    this.cancelPending();
    this.customTarget.dispose();
    this.customTarget = null;
    this.customName = null;
    return true;
  }

  public cancelPending(): void {
    this.loadSequence += 1;
  }

  public apply(
    scene: THREE.Scene,
    preset: EnvironmentPreset,
    customName: string | null = null
  ): StudioLightProfile {
    if (preset === 'custom' && this.hasCustomEnvironment(customName)) {
      scene.environment = this.customTarget?.texture ?? this.studioTarget?.texture ?? null;
      scene.environmentIntensity = 1;
      return PROFILES.studio;
    }

    scene.environment = this.studioTarget?.texture ?? null;
    const profile = preset === 'custom' ? PROFILES.studio : (PROFILES[preset] ?? PROFILES.studio);
    scene.environmentIntensity = profile.environmentIntensity;
    return profile;
  }

  public async loadHdr(file: File): Promise<boolean> {
    if (this.disposed) return false;
    if (!file.name.toLowerCase().endsWith('.hdr')) {
      throw new Error('Environment files must use the Radiance .hdr format.');
    }
    if (file.size > MAX_MODEL_FILE_BYTES) {
      const limitMiB = MAX_MODEL_FILE_BYTES / BYTES_PER_MIB;
      throw new Error(`HDR environment exceeds the configured ${limitMiB.toFixed(0)} MiB import limit.`);
    }

    const sequence = ++this.loadSequence;
    await this.renderer.init();
    if (this.disposed || sequence !== this.loadSequence) return false;

    const url = URL.createObjectURL(file);
    try {
      const texture = await new RGBELoader().loadAsync(url);
      if (this.disposed || sequence !== this.loadSequence) {
        texture.dispose();
        return false;
      }

      const target = (() => {
        try {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          return this.pmrem.fromEquirectangular(texture);
        } finally {
          texture.dispose();
        }
      })();

      if (this.disposed || sequence !== this.loadSequence) {
        target.dispose();
        return false;
      }

      this.customTarget?.dispose();
      this.customTarget = target;
      this.customName = file.name;
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.customTarget?.dispose();
    this.customTarget = null;
    this.customName = null;
    this.studioTarget?.dispose();
    this.studioTarget = null;
    this.studioPrepared = true;
    this.pmrem.dispose();
  }
}
