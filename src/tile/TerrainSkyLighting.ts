import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  TERRAIN_CONFIG,
  TERRAIN_LIGHTING_PRESET_IDS,
  type TerrainLightingPresetId
} from '../config/terrainConfig';
import { metersToUnits } from './TerrainScale';

export type { TerrainLightingPresetId };

export interface TerrainLightingPreset {
  id: TerrainLightingPresetId;
  label: string;
  elevationDegrees: number;
  azimuthDegrees: number;
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  groundColor: number;
  hemisphereIntensity: number;
  environmentIntensity: number;
  exposure: number;
  /** Fog and the fallback clear colour. Explicit so no GPU read-back is needed. */
  horizon: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  /** `studio` keeps the neutral RoomEnvironment so inspection has a fixed reference. */
  usesSky: boolean;
}

export const TERRAIN_LIGHTING_PRESETS: readonly TerrainLightingPreset[] = [
  {
    id: 'dawn', label: 'Dawn', elevationDegrees: 4, azimuthDegrees: 95,
    sunColor: 0xffb489, sunIntensity: 4.16, skyColor: 0x9fb4d8, groundColor: 0x2b2620,
    hemisphereIntensity: 0.81, environmentIntensity: 0.52, exposure: 1.3, horizon: 0xc0a89c,
    turbidity: 6, rayleigh: 3, mieCoefficient: 0.008, mieDirectionalG: 0.82,
    cloudCoverage: 0.35, cloudDensity: 0.4, usesSky: true
  },
  {
    id: 'morning', label: 'Morning', elevationDegrees: 26, azimuthDegrees: 120,
    sunColor: 0xfff0d8, sunIntensity: 8.16, skyColor: 0xc4d8f5, groundColor: 0x2e2a24,
    hemisphereIntensity: 1.23, environmentIntensity: 0.93, exposure: 0.356, horizon: 0xbdd0e6,
    turbidity: 3, rayleigh: 1.6, mieCoefficient: 0.005, mieDirectionalG: 0.76,
    cloudCoverage: 0.3, cloudDensity: 0.35, usesSky: true
  },
  {
    id: 'noon', label: 'Noon', elevationDegrees: 66, azimuthDegrees: 150,
    sunColor: 0xfffaf2, sunIntensity: 5.58, skyColor: 0xd2e2fb, groundColor: 0x33302a,
    hemisphereIntensity: 0.65, environmentIntensity: 0.56, exposure: 0.313, horizon: 0xcadcf0,
    turbidity: 2.2, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.72,
    cloudCoverage: 0.25, cloudDensity: 0.3, usesSky: true
  },
  {
    id: 'golden', label: 'Golden hour', elevationDegrees: 11, azimuthDegrees: 205,
    sunColor: 0xffc98d, sunIntensity: 5.4, skyColor: 0xb7c4e0, groundColor: 0x33281e,
    hemisphereIntensity: 0.82, environmentIntensity: 0.7, exposure: 0.34, horizon: 0xd0ad8c,
    turbidity: 5, rayleigh: 2.4, mieCoefficient: 0.007, mieDirectionalG: 0.84,
    cloudCoverage: 0.32, cloudDensity: 0.38, usesSky: true
  },
  {
    id: 'dusk', label: 'Dusk', elevationDegrees: 1.5, azimuthDegrees: 250,
    sunColor: 0xff9c6b, sunIntensity: 5.04, skyColor: 0x6f80ad, groundColor: 0x1e1a18,
    hemisphereIntensity: 1.54, environmentIntensity: 0.84, exposure: 1.75, horizon: 0x9c8296,
    turbidity: 8, rayleigh: 3.4, mieCoefficient: 0.009, mieDirectionalG: 0.86,
    cloudCoverage: 0.42, cloudDensity: 0.45, usesSky: true
  },
  {
    id: 'overcast', label: 'Overcast', elevationDegrees: 44, azimuthDegrees: 150,
    sunColor: 0xdfe6ee, sunIntensity: 2.47, skyColor: 0xd6dde6, groundColor: 0x35353a,
    hemisphereIntensity: 3.17, environmentIntensity: 1.11, exposure: 0.382, horizon: 0xbcc3cc,
    turbidity: 12, rayleigh: 0.6, mieCoefficient: 0.02, mieDirectionalG: 0.5,
    cloudCoverage: 0.85, cloudDensity: 0.7, usesSky: true
  },
  {
    id: 'studio', label: 'Studio (neutral)', elevationDegrees: 48, azimuthDegrees: 135,
    sunColor: 0xfff3e4, sunIntensity: 1.24, skyColor: 0xedf4ff, groundColor: 0x231d1a,
    hemisphereIntensity: 0.45, environmentIntensity: 0.43, exposure: 0.92,
    horizon: TERRAIN_CONFIG.preview.skyColor,
    turbidity: 2, rayleigh: 1, mieCoefficient: 0.005, mieDirectionalG: 0.8,
    cloudCoverage: 0, cloudDensity: 0, usesSky: false
  }
];

const CUBE_SIZE = 128;
const SUN_DISTANCE_METERS = 4000;

function presetById(id: TerrainLightingPresetId): TerrainLightingPreset {
  return TERRAIN_LIGHTING_PRESETS.find((preset) => preset.id === id)
    ?? TERRAIN_LIGHTING_PRESETS[0]!;
}

export function isTerrainLightingPresetId(value: string): value is TerrainLightingPresetId {
  return (TERRAIN_LIGHTING_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * Sun, sky and shadow as one coupled unit. Moving the sun has to move the light, the sky
 * gradient, the image-based lighting and the fog together, or the scene stops reading as a
 * time of day and starts reading as a slider.
 *
 * The sky is rendered into a private scene and baked to a cube target rather than added to
 * the visible scene: the dome's conventional 10000-unit scale sits far outside the camera's
 * far plane, and that far plane now moves with the orbit distance.
 */
export class TerrainSkyLighting {
  private readonly sky = new Sky();
  private readonly skyScene = new THREE.Scene();
  private readonly cubeTarget: THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly sun = new THREE.DirectionalLight(0xfff3e4, 2.1);
  private readonly hemisphere = new THREE.HemisphereLight(0xedf4ff, 0x231d1a, 0.7);
  private readonly sunDirection = new THREE.Vector3();
  private readonly shadowFocus = new THREE.Vector3();
  private readonly fogColor = new THREE.Color();
  private renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private environmentTarget: THREE.WebGLRenderTarget | null = null;
  private preset: TerrainLightingPreset = presetById(TERRAIN_CONFIG.lighting.preset);
  private elevationDegrees = TERRAIN_CONFIG.lighting.sunElevationDegrees;
  private azimuthDegrees = TERRAIN_CONFIG.lighting.sunAzimuthDegrees;
  private shadowRadiusMeters = TERRAIN_CONFIG.lighting.shadowFocusRadiusMeters;
  private disposed = false;

  public constructor(
    private readonly scene: THREE.Scene,
    private readonly terrainSize: number
  ) {
    this.sky.scale.setScalar(1000);
    this.skyScene.add(this.sky);
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType });
    this.cubeCamera = new THREE.CubeCamera(0.1, 5000, this.cubeTarget);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(TERRAIN_CONFIG.lighting.shadowMapSize);
    // The terrain writes analytic rather than geometric normals, so the normal bias does
    // most of the acne work here and the depth bias is only a backstop.
    this.sun.shadow.normalBias = metersToUnits(
      TERRAIN_CONFIG.lighting.shadowNormalBiasMeters,
      terrainSize
    );
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.hemisphere);
  }

  public get currentPreset(): TerrainLightingPresetId {
    return this.preset.id;
  }

  public get sunElevationDegrees(): number {
    return this.elevationDegrees;
  }

  public get horizonColor(): THREE.Color {
    return this.fogColor;
  }

  public attachRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer !== null || this.disposed) return;
    this.renderer = renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.apply('final');
  }

  public setPreset(id: TerrainLightingPresetId): void {
    this.preset = presetById(id);
    this.elevationDegrees = this.preset.elevationDegrees;
    this.azimuthDegrees = this.preset.azimuthDegrees;
    this.apply('final');
  }

  public setSun(
    state: { elevationDegrees?: number; azimuthDegrees?: number },
    quality: 'drag' | 'final'
  ): void {
    if (state.elevationDegrees !== undefined) {
      this.elevationDegrees = Math.max(-5, Math.min(89, state.elevationDegrees));
    }
    if (state.azimuthDegrees !== undefined) this.azimuthDegrees = state.azimuthDegrees;
    this.apply(quality);
  }

  /** Spends the shadow map where the viewer actually is rather than across nine tiles. */
  public setShadowFocus(center: THREE.Vector3, radiusMeters: number): void {
    this.shadowFocus.copy(center);
    this.shadowRadiusMeters = radiusMeters;
    this.updateSunTransform();
  }

  public dispose(): void {
    this.disposed = true;
    this.sky.material.dispose();
    this.sky.geometry.dispose();
    this.cubeTarget.dispose();
    this.environmentTarget?.dispose();
    this.pmrem?.dispose();
  }

  private apply(quality: 'drag' | 'final'): void {
    const preset = this.preset;
    this.fogColor.setHex(preset.horizon);
    this.sun.color.setHex(preset.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.hemisphere.color.setHex(preset.skyColor);
    this.hemisphere.groundColor.setHex(preset.groundColor);
    this.hemisphere.intensity = preset.hemisphereIntensity;
    this.scene.environmentIntensity = preset.environmentIntensity;
    if (this.renderer !== null) this.renderer.toneMappingExposure = preset.exposure;

    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity!.value = preset.turbidity;
    uniforms.rayleigh!.value = preset.rayleigh;
    uniforms.mieCoefficient!.value = preset.mieCoefficient;
    uniforms.mieDirectionalG!.value = preset.mieDirectionalG;
    uniforms.cloudCoverage!.value = preset.cloudCoverage;
    uniforms.cloudDensity!.value = preset.cloudDensity;

    this.updateSunTransform();
    uniforms.sunPosition!.value.copy(this.sunDirection);
    this.refreshEnvironment(quality);
  }

  private updateSunTransform(): void {
    const elevation = THREE.MathUtils.degToRad(this.elevationDegrees);
    const azimuth = THREE.MathUtils.degToRad(this.azimuthDegrees);
    this.sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);

    const distance = metersToUnits(SUN_DISTANCE_METERS, this.terrainSize);
    this.sun.position.copy(this.shadowFocus).addScaledVector(this.sunDirection, distance);
    this.sun.target.position.copy(this.shadowFocus);
    this.sun.target.updateMatrixWorld();

    const radius = metersToUnits(this.shadowRadiusMeters, this.terrainSize);
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = Math.max(distance - radius * 4, 0.01);
    camera.far = distance + radius * 4;
    camera.updateProjectionMatrix();
  }

  private refreshEnvironment(quality: 'drag' | 'final'): void {
    const renderer = this.renderer;
    if (renderer === null) return;

    if (!this.preset.usesSky) {
      this.scene.background = new THREE.Color(this.preset.horizon);
      if (quality !== 'final') return;
      const room = new RoomEnvironment();
      this.replaceEnvironment(this.pmrem?.fromScene(room) ?? null);
      room.dispose();
      return;
    }

    const uniforms = this.sky.material.uniforms;
    if (quality === 'final') {
      // Preetham puts an enormous value in the sun disc. Integrating that into the
      // irradiance blows the whole scene out to white, so the environment is baked with
      // the disc hidden, exactly as the Sky addon documents.
      uniforms.showSunDisc!.value = 0;
      this.cubeCamera.update(renderer, this.skyScene);
      this.replaceEnvironment(this.pmrem?.fromCubemap(this.cubeTarget.texture) ?? null);
      uniforms.showSunDisc!.value = 1;
    }
    // The cube bake is a trivial shader over six small faces, so the visible background
    // re-bakes on every change and tracks the sun live. Only PMREM needs the debounce.
    this.cubeCamera.update(renderer, this.skyScene);
    this.scene.background = this.cubeTarget.texture;
  }

  private replaceEnvironment(target: THREE.WebGLRenderTarget | null): void {
    if (target === null) return;
    this.environmentTarget?.dispose();
    this.environmentTarget = target;
    this.scene.environment = target.texture;
  }
}
