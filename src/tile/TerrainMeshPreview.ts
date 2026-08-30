import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import {
  createOptionalWebGlRenderer,
  WEBGL2_UNAVAILABLE_MESSAGE
} from '../engine/WebGlRenderer';
import {
  buildTerrainMaterialMasks,
  TERRAIN_BASE_MATERIAL_COUNT,
  TERRAIN_MATERIAL_COUNT
} from './TerrainMaterialMasks';
import {
  TerrainPlayerController,
  wrapTerrainCoordinate,
  type TerrainPlayerState
} from './TerrainPlayerController';
import { TerrainPlayerOverlay } from './TerrainPlayerOverlay';
import { TerrainGameProps } from './TerrainGameProps';
import { metersToUnits, unitsToMeters } from './TerrainScale';
import {
  TerrainSkyLighting,
  type TerrainLightingPresetId
} from './TerrainSkyLighting';
import { TerrainRiverLayer } from './TerrainRiverLayer';
import { TerrainScaleReference } from './TerrainScaleReference';
import { marchTerrainRay, sampleTerrainMaterialAt } from './TerrainSurfaceProbe';
import {
  TERRAIN_MATERIALS,
  type TerrainFields,
  type TerrainPaintMask,
  type TerrainPbrTextureSet,
  type TerrainTextureSource
} from './TerrainTypes';

const TERRAIN_SIZE = 10;
const TERRAIN_HEIGHT = TERRAIN_SIZE * (TERRAIN_CONFIG.heightScale / TERRAIN_CONFIG.worldSize);
const MIN_DISTANCE = metersToUnits(TERRAIN_CONFIG.camera.orbitMinMeters, TERRAIN_SIZE);
const MAX_DISTANCE = metersToUnits(TERRAIN_CONFIG.camera.orbitMaxMeters, TERRAIN_SIZE);
/** Widest near plane we use. Close-ups tighten it further; see `applyCameraClipping()`. */
const ORBIT_NEAR = 0.1;
const MIN_NEAR = metersToUnits(0.02, TERRAIN_SIZE);
const MIN_FAR = metersToUnits(600, TERRAIN_SIZE);
/**
 * Under this distance a close-up near a tile edge would show the void beyond the centre
 * tile, so the wrapped neighbours have to be drawn even outside player mode.
 */
const REPEATED_TILE_DISTANCE = metersToUnits(200, TERRAIN_SIZE);
const BACKGROUND_COLOR = TERRAIN_CONFIG.preview.skyColor;

type TerrainLayerKind = 'base' | 'override';

interface TerrainRenderLayer {
  materialIndex: number;
  kind: TerrainLayerKind;
  mask: THREE.DataTexture;
  material: THREE.MeshPhysicalMaterial;
  meshes: THREE.Mesh[];
}

/** A material's two GPU sets: terrain repeat and prop repeat, which move as one unit. */
interface TerrainGpuPair {
  terrain: TerrainGpuTextureSet;
  prop: TerrainGpuTextureSet;
}

interface TerrainGpuTextureSet {
  textures: THREE.Texture[];
  albedo: THREE.Texture;
  roughness: THREE.Texture | null;
  normal: THREE.Texture | null;
  height: THREE.Texture | null;
  clearcoat: THREE.Texture | null;
  clearcoatRoughness: THREE.Texture | null;
  metallic: THREE.Texture | null;
  ao: THREE.Texture | null;
  emissive: THREE.Texture | null;
}

export interface TerrainMeshPreviewCallbacks {
  onPlayerStateChange?: (state: TerrainPlayerState) => void;
  onPlayerStatus?: (message: string) => void;
  onPlayerNavigationChange?: () => void;
}

export interface TerrainMapMarker {
  x: number;
  z: number;
  directionX: number;
  directionZ: number;
}

function fieldIndex(x: number, y: number, size: number): number {
  const wrappedX = ((x % size) + size) % size;
  const wrappedY = ((y % size) + size) % size;
  return wrappedY * size + wrappedX;
}

function maskPixels(values: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    const target = index * 4;
    rgba[target] = value;
    rgba[target + 1] = value;
    rgba[target + 2] = value;
    rgba[target + 3] = 255;
  }
  return rgba;
}

function createMaskTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  texture.name = 'PTL terrain material mask';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

function createMaterial(
  materialIndex: number,
  kind: TerrainLayerKind,
  mask: THREE.Texture
): THREE.MeshPhysicalMaterial {
  const fallback = TERRAIN_MATERIALS[materialIndex]?.color ?? TERRAIN_MATERIALS[0]!.color;
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(fallback[0] / 255, fallback[1] / 255, fallback[2] / 255),
    roughness: 0.78,
    metalness: 0,
    alphaMap: mask,
    alphaTest: kind === 'base' ? 0.5 : 0.005,
    transparent: kind === 'override',
    depthWrite: kind === 'base',
    side: THREE.FrontSide,
    // Ground is not a mirror. `specularF90` defaults to 1, so at the grazing angles you get
    // looking across terrain at eye level the sky IBL reflects almost perfectly and washes
    // the albedo out to flat sky colour. Capping F90 keeps the material readable on foot.
    specularIntensity: 0.2
  });
  material.name = `PTL terrain ${kind} material ${materialIndex}`;
  material.dithering = true;
  if (kind === 'override') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
  }
  return material;
}

function createPropMaterial(materialIndex: number): THREE.MeshPhysicalMaterial {
  const fallback = TERRAIN_MATERIALS[materialIndex]?.color ?? TERRAIN_MATERIALS[0]!.color;
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(fallback[0] / 255, fallback[1] / 255, fallback[2] / 255),
    roughness: 0.72,
    metalness: 0
  });
  material.name = `PTL game prop material ${materialIndex}`;
  material.dithering = true;
  return material;
}

export class TerrainMeshPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, ORBIT_NEAR, 100);
  private readonly geometry: THREE.PlaneGeometry;
  private readonly terrainMeshes: THREE.Mesh[] = [];
  private readonly collisionMeshes: THREE.Mesh[] = [];
  private readonly layers: TerrainRenderLayer[] = [];
  private readonly materialTextures = new Map<number, TerrainGpuTextureSet>();
  private readonly propTextureSets = new Map<number, TerrainGpuTextureSet>();
  /**
   * A/B and hover-restore stashes. Storing `null` is meaningful: it records that the slot
   * had no texture at all, which is how restoring to a built-in colour works.
   *
   * Budget: one pair is ~6.3 MB (9 channels x 256 squared RGBA x 1.33 mips x 2 repeats).
   * Compare is opt-in per slot and only one preview ever exists, so the ceiling is ~57 MB.
   */
  private readonly compareSets = new Map<number, TerrainGpuPair | null>();
  private readonly previewSets = new Map<number, TerrainGpuPair | null>();
  private readonly propMaterials: THREE.MeshPhysicalMaterial[] = [];
  private readonly gameProps: TerrainGameProps;
  private readonly riverLayer: TerrainRiverLayer;
  private readonly player: TerrainPlayerController;
  private readonly playerOverlay: TerrainPlayerOverlay;
  private readonly playerFog = new THREE.Fog(
    BACKGROUND_COLOR,
    TERRAIN_CONFIG.player.fogStartMeters * TERRAIN_SIZE / TERRAIN_CONFIG.worldSize,
    TERRAIN_CONFIG.player.fogEndMeters * TERRAIN_SIZE / TERRAIN_CONFIG.worldSize
  );
  private readonly lighting: TerrainSkyLighting;
  private readonly shadowFocusPoint = new THREE.Vector3();
  private readonly shadowForward = new THREE.Vector3();
  private readonly scaleReference: TerrainScaleReference;
  private readonly orbitTarget = new THREE.Vector3(0, TERRAIN_HEIGHT * 0.35, 0);
  private focusFrame = 0;
  private readonly materialInfo = new Map<number, { presetName: string | null; metersPerTile: number }>();
  private terrainPaint: Readonly<TerrainPaintMask> | null = null;
  private lastReadoutAt = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly probeDirection = new THREE.Vector3();
  private readonly observer: ResizeObserver;
  private readonly visibilityObserver: MutationObserver;
  private readonly inputAbort = new AbortController();
  private renderer: THREE.WebGLRenderer | null = null;
  private rendererUnavailable = false;
  private terrainFields: Readonly<TerrainFields> | null = null;
  private readonly materialRepeats: number[] = new Array<number>(TERRAIN_MATERIAL_COUNT)
    .fill(TERRAIN_CONFIG.materialRepeat);
  private yaw = 0.72;
  private pitch = 0.78;
  private distance = metersToUnits(590, TERRAIN_SIZE);
  private drag: { pointerId: number; x: number; y: number } | null = null;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: Readonly<TerrainMeshPreviewCallbacks> = {}
  ) {
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.geometry = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_CONFIG.meshSegments,
      TERRAIN_CONFIG.meshSegments
    );
    this.geometry.rotateX(-Math.PI / 2);
    this.createRenderLayers();
    this.createPropMaterials();
    this.createTerrainTiles();
    this.gameProps = new TerrainGameProps(
      this.scene,
      this.propMaterials,
      TERRAIN_CONFIG.player.tileRadius,
      TERRAIN_SIZE,
      TERRAIN_HEIGHT,
      () => this.render()
    );
    this.riverLayer = new TerrainRiverLayer(
      this.scene,
      this.geometry,
      TERRAIN_CONFIG.player.tileRadius,
      TERRAIN_SIZE
    );
    this.lighting = new TerrainSkyLighting(this.scene, TERRAIN_SIZE);
    this.scaleReference = new TerrainScaleReference(this.scene, TERRAIN_SIZE);
    this.syncFogColor();
    this.playerOverlay = new TerrainPlayerOverlay(this.canvas, {
      onToggle: () => this.togglePlayerMode()
    });
    this.player = new TerrainPlayerController(
      this.canvas,
      this.camera,
      () => this.collisionMeshes,
      TERRAIN_SIZE,
      TERRAIN_HEIGHT,
      {
        onRender: () => this.render(),
        onStateChange: (state) => this.handlePlayerStateChange(state),
        onStatus: (message) => {
          this.playerOverlay.setStatus(message);
          this.callbacks.onPlayerStatus?.(message);
        }
      }
    );
    this.bindInput();
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(canvas);
    this.visibilityObserver = new MutationObserver(() => {
      if (this.canvas.hidden && this.player.isEngaged) this.player.exit();
    });
    this.visibilityObserver.observe(canvas, { attributes: true, attributeFilter: ['hidden'] });
    this.updateCamera();
  }

  /** Terrain tile extents in world units, so callers can convert to and from metres. */
  public static readonly worldSizeUnits = TERRAIN_SIZE;
  public static readonly worldHeightUnits = TERRAIN_HEIGHT;

  /**
   * Terrain position under a screen point, wrapped into the centre tile.
   *
   * The raycast is purely geometric: `Mesh.raycast` ignores `alphaTest`, so the base
   * layer registers a hit everywhere regardless of which material's mask is opaque
   * there. Player spawn placement already relies on this.
   */
  public pickTerrain(clientX: number, clientY: number): { x: number; z: number } | null {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.collisionMeshes, false)[0];
    if (hit === undefined) return null;
    return {
      x: wrapTerrainCoordinate(hit.point.x, TERRAIN_SIZE),
      z: wrapTerrainCoordinate(hit.point.z, TERRAIN_SIZE)
    };
  }

  /** Unwrapped hit point, for pivoting on the tile the pointer is actually over. */
  public pickTerrainPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.collisionMeshes, false)[0]?.point.clone() ?? null;
  }

  /** Wrapped camera position and heading for the 2D inset map. */
  public getMapMarker(): TerrainMapMarker | null {
    if (!this.player.isEngaged) return null;
    this.camera.getWorldDirection(this.probeDirection);
    return {
      x: wrapTerrainCoordinate(this.camera.position.x, TERRAIN_SIZE),
      z: wrapTerrainCoordinate(this.camera.position.z, TERRAIN_SIZE),
      directionX: this.probeDirection.x,
      directionZ: this.probeDirection.z
    };
  }

  /** Display names for the reticle read-out; the preview only knows material indices. */
  public setMaterialInfo(
    materialIndex: number,
    info: { presetName: string | null; metersPerTile: number }
  ): void {
    this.materialInfo.set(materialIndex, info);
  }

  private describeMaterialHit(hit: ReturnType<typeof sampleTerrainMaterialAt>): string {
    const entry = TERRAIN_MATERIALS.find((material) => material.id === hit.material);
    const info = entry === undefined ? undefined : this.materialInfo.get(entry.index);
    const parts = [entry?.label ?? hit.material];
    if (info?.presetName != null) parts.push(info.presetName);
    if (info !== undefined) parts.push(`${info.metersPerTile.toFixed(1)} m/tile`);
    parts.push(`${unitsToMeters(hit.heightMeters, TERRAIN_SIZE).toFixed(0)} m`);
    if (hit.overridden) parts.push('painted override');
    return parts.join(' · ');
  }

  /** Names both the ground underfoot and the material at the centre reticle. */
  private updateMaterialReadout(): void {
    const fields = this.terrainFields;
    const paint = this.terrainPaint;
    if (fields === null || paint === null || !this.player.isEngaged) return;
    const now = performance.now();
    if (now - this.lastReadoutAt < 160) return;
    this.lastReadoutAt = now;

    const feet = sampleTerrainMaterialAt(
      fields,
      paint,
      this.camera.position.x,
      this.camera.position.z,
      TERRAIN_SIZE,
      TERRAIN_HEIGHT
    );
    this.camera.getWorldDirection(this.probeDirection);
    const marchedPoint = marchTerrainRay(
      fields,
      this.camera.position,
      this.probeDirection,
      TERRAIN_SIZE,
      TERRAIN_HEIGHT,
      metersToUnits(450, TERRAIN_SIZE),
      72,
      6
    );
    // A nearly horizontal ray can graze a steep silhouette entirely between two march
    // samples. The read-out is already throttled to 6 Hz, so an exact centre raycast is a
    // safe miss-only fallback and keeps the HUD consistent with what the reticle covers.
    const bounds = this.canvas.getBoundingClientRect();
    const point = marchedPoint ?? this.pickTerrainPoint(
      bounds.left + bounds.width * 0.5,
      bounds.top + bounds.height * 0.5
    );
    const aim = point === null
      ? null
      : sampleTerrainMaterialAt(fields, paint, point.x, point.z, TERRAIN_SIZE, TERRAIN_HEIGHT);
    this.playerOverlay.setMaterialReadout(
      `Feet: ${this.describeMaterialHit(feet)}`,
      aim === null ? 'Aim: sky / beyond probe range' : `Aim: ${this.describeMaterialHit(aim)}`
    );
  }

  public setScaleReferenceVisible(visible: boolean): void {
    this.scaleReference.setEnabled(visible);
    this.render();
  }

  /** One-click close inspection centred on the visible surface. */
  public inspectSurface(): boolean {
    if (this.player.isEngaged) this.player.exit();
    const bounds = this.canvas.getBoundingClientRect();
    const point = this.pickTerrainPoint(
      bounds.left + bounds.width * 0.5,
      bounds.top + bounds.height * 0.52
    );
    if (point === null) return false;
    this.distance = metersToUnits(14, TERRAIN_SIZE);
    this.scaleReference.setEnabled(true);
    this.focusOrbitOn(point);
    return true;
  }

  /** Eases the orbit pivot to a point so a close-up can be aimed rather than dragged to. */
  public focusOrbitOn(point: THREE.Vector3): void {
    if (this.player.isEngaged) return;
    const from = this.orbitTarget.clone();
    const to = point.clone();
    const duration = TERRAIN_CONFIG.camera.focusAnimationMs;
    if (this.focusFrame !== 0) cancelAnimationFrame(this.focusFrame);
    if (duration <= 0) {
      this.orbitTarget.copy(to);
      this.updateCamera();
      return;
    }
    const start = performance.now();
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      this.orbitTarget.lerpVectors(from, to, eased);
      this.updateCamera();
      this.focusFrame = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    this.focusFrame = requestAnimationFrame(step);
  }

  private resetOrbitTarget(): void {
    if (this.focusFrame !== 0) {
      cancelAnimationFrame(this.focusFrame);
      this.focusFrame = 0;
    }
    this.orbitTarget.set(0, TERRAIN_HEIGHT * 0.35, 0);
  }

  public get playerState(): TerrainPlayerState {
    return this.player.currentState;
  }

  public startPlayerPlacement(): boolean {
    return this.player.beginPlacement();
  }

  public exitPlayerMode(): void {
    this.player.exit();
  }

  public setGamePropDensity(density: number): void {
    this.gameProps.setDensity(density);
    this.render();
  }

  public setGamePropsVisible(visible: boolean): void {
    this.gameProps.setVisible(visible);
    this.render();
  }

  /** Replaces a slot outright, discarding any A/B history and any hover preview. */
  public setMaterialTextures(materialIndex: number, textures: TerrainPbrTextureSet | null): void {
    this.endPreview(materialIndex, 'discard');
    this.disposePair(this.compareSets.get(materialIndex) ?? null);
    this.compareSets.delete(materialIndex);
    this.disposePair(this.takeLive(materialIndex));
    this.installLive(materialIndex, this.createPair(materialIndex, textures));
    this.render();
  }

  /** Assigns, keeping the outgoing set as the A/B counterpart instead of disposing it. */
  public setMaterialTexturesRetaining(
    materialIndex: number,
    textures: TerrainPbrTextureSet | null
  ): void {
    this.endPreview(materialIndex, 'discard');
    this.disposePair(this.compareSets.get(materialIndex) ?? null);
    this.compareSets.set(materialIndex, this.takeLive(materialIndex));
    this.installLive(materialIndex, this.createPair(materialIndex, textures));
    this.render();
  }

  /**
   * Shows a candidate without committing it, so scrubbing a picker scrubs the world. The
   * real assignment is stashed on the first call and comes back via `restoreMaterial`.
   */
  public previewMaterialTextures(
    materialIndex: number,
    textures: TerrainPbrTextureSet | null
  ): void {
    const live = this.takeLive(materialIndex);
    if (this.previewSets.has(materialIndex)) {
      // Already previewing, so the outgoing set is a previous candidate, not the real one.
      this.disposePair(live);
    } else {
      this.previewSets.set(materialIndex, live);
    }
    this.installLive(materialIndex, this.createPair(materialIndex, textures));
    this.render();
  }

  /** Snapshots the committed slot before applying the instant colour stand-in. */
  public previewMaterialTint(materialIndex: number, color: THREE.ColorRepresentation): void {
    if (this.previewSets.has(materialIndex)) {
      this.disposePair(this.takeLive(materialIndex));
    } else {
      this.previewSets.set(materialIndex, this.takeLive(materialIndex));
    }
    this.applyMaterialTint(materialIndex, color);
  }

  /** Puts the real assignment back. A map swap, so it costs no GPU work. */
  public restoreMaterial(materialIndex: number): void {
    if (!this.previewSets.has(materialIndex)) return;
    this.endPreview(materialIndex, 'restore');
    this.render();
  }

  public isMaterialPreviewing(materialIndex: number): boolean {
    return this.previewSets.has(materialIndex);
  }

  public hasMaterialCompare(materialIndex: number): boolean {
    return this.compareSets.has(materialIndex);
  }

  /** Flips between the current and previous assignment. Also a pure swap. */
  public toggleMaterialCompare(materialIndex: number): boolean {
    if (!this.compareSets.has(materialIndex)) return false;
    const other = this.compareSets.get(materialIndex) ?? null;
    this.compareSets.set(materialIndex, this.takeLive(materialIndex));
    this.installLive(materialIndex, other);
    this.render();
    return true;
  }

  public clearMaterialCompare(materialIndex: number): void {
    this.disposePair(this.compareSets.get(materialIndex) ?? null);
    this.compareSets.delete(materialIndex);
  }

  /**
   * Flat colour applied within a frame while the real atlas is still downloading, so a
   * picker never feels like it stalled. Allocates and disposes nothing.
   */
  public setMaterialTint(materialIndex: number, color: THREE.ColorRepresentation | null): void {
    if (color === null) {
      this.installLive(materialIndex, this.currentPair(materialIndex));
      this.render();
      return;
    }
    this.applyMaterialTint(materialIndex, color);
  }

  private applyMaterialTint(materialIndex: number, color: THREE.ColorRepresentation): void {
    for (const layer of this.layers) {
      if (layer.materialIndex !== materialIndex) continue;
      this.applyTextureSet(layer.material, materialIndex, null);
      layer.material.color.set(color);
      layer.material.needsUpdate = true;
    }
    const propMaterial = this.propMaterials[materialIndex];
    if (propMaterial !== undefined) {
      this.applyTextureSet(propMaterial, materialIndex, null);
      propMaterial.color.set(color);
      propMaterial.needsUpdate = true;
    }
    this.render();
  }

  private endPreview(materialIndex: number, mode: 'restore' | 'discard'): void {
    if (!this.previewSets.has(materialIndex)) return;
    const original = this.previewSets.get(materialIndex) ?? null;
    this.previewSets.delete(materialIndex);
    this.disposePair(this.takeLive(materialIndex));
    if (mode === 'restore') {
      this.installLive(materialIndex, original);
      return;
    }
    this.disposePair(original);
  }

  private currentPair(materialIndex: number): TerrainGpuPair | null {
    const terrain = this.materialTextures.get(materialIndex);
    const prop = this.propTextureSets.get(materialIndex);
    return terrain === undefined || prop === undefined ? null : { terrain, prop };
  }

  private takeLive(materialIndex: number): TerrainGpuPair | null {
    const pair = this.currentPair(materialIndex);
    this.materialTextures.delete(materialIndex);
    this.propTextureSets.delete(materialIndex);
    return pair;
  }

  private createPair(
    materialIndex: number,
    textures: TerrainPbrTextureSet | null
  ): TerrainGpuPair | null {
    if (textures === null) return null;
    return {
      terrain: this.createGpuTextureSet(textures, this.terrainRepeatFor(materialIndex)),
      prop: this.createGpuTextureSet(textures, this.propRepeatFor(materialIndex))
    };
  }

  private installLive(materialIndex: number, pair: TerrainGpuPair | null): void {
    if (pair === null) {
      this.materialTextures.delete(materialIndex);
      this.propTextureSets.delete(materialIndex);
    } else {
      this.materialTextures.set(materialIndex, pair.terrain);
      this.propTextureSets.set(materialIndex, pair.prop);
    }
    for (const layer of this.layers) {
      if (layer.materialIndex !== materialIndex) continue;
      this.applyTextureSet(layer.material, materialIndex, pair?.terrain ?? null);
    }
    const propMaterial = this.propMaterials[materialIndex];
    if (propMaterial === undefined) return;
    this.applyTextureSet(propMaterial, materialIndex, pair?.prop ?? null);
  }

  private disposePair(pair: TerrainGpuPair | null): void {
    if (pair === null) return;
    for (const texture of pair.terrain.textures) texture.dispose();
    for (const texture of pair.prop.textures) texture.dispose();
  }

  /**
   * Single iteration point over every GPU set this preview owns, live or stashed. Anything
   * walking textures must go through here: missing the stashes leaks them on unmount and,
   * worse, lets a scale change apply to only one side of an A/B comparison.
   */
  private *allTextureSets(): Generator<TerrainGpuTextureSet> {
    yield* this.materialTextures.values();
    yield* this.propTextureSets.values();
    for (const pair of [...this.compareSets.values(), ...this.previewSets.values()]) {
      if (pair === null) continue;
      yield pair.terrain;
      yield pair.prop;
    }
  }

  public update(
    fields: Readonly<TerrainFields>,
    paint: Readonly<TerrainPaintMask>,
    repeats: readonly number[]
  ): void {
    if (this.canvas.hidden) return;
    if (!this.ensureRenderer()) return;

    if (this.terrainFields !== fields) {
      this.resetOrbitTarget();
      this.updateGeometry(fields);
      this.terrainFields = fields;
    }
    this.terrainPaint = paint;
    this.updateMaterialMasks(fields, paint);
    this.setMaterialRepeats(repeats);
    this.render();
  }

  public dispose(): void {
    this.player.dispose();
    this.playerOverlay.dispose();
    this.inputAbort.abort();
    this.observer.disconnect();
    this.visibilityObserver.disconnect();
    for (const textureSet of this.allTextureSets()) {
      for (const texture of textureSet.textures) texture.dispose();
    }
    for (const layer of this.layers) {
      layer.mask.dispose();
      layer.material.dispose();
    }
    if (this.focusFrame !== 0) cancelAnimationFrame(this.focusFrame);
    this.scaleReference.dispose();
    this.lighting.dispose();
    this.gameProps.dispose();
    for (const material of this.propMaterials) material.dispose();
    this.riverLayer.dispose();
    this.geometry.dispose();
    this.renderer?.dispose();
  }

  private createRenderLayers(): void {
    for (let materialIndex = 0; materialIndex < TERRAIN_BASE_MATERIAL_COUNT; materialIndex += 1) {
      this.layers.push(this.createRenderLayer(materialIndex, 'base'));
    }
    for (let materialIndex = 0; materialIndex < TERRAIN_MATERIAL_COUNT; materialIndex += 1) {
      this.layers.push(this.createRenderLayer(materialIndex, 'override'));
    }
  }

  private createPropMaterials(): void {
    for (let materialIndex = 0; materialIndex < TERRAIN_MATERIAL_COUNT; materialIndex += 1) {
      this.propMaterials.push(createPropMaterial(materialIndex));
    }
  }

  private createRenderLayer(materialIndex: number, kind: TerrainLayerKind): TerrainRenderLayer {
    const mask = createMaskTexture();
    return {
      materialIndex,
      kind,
      mask,
      material: createMaterial(materialIndex, kind, mask),
      meshes: []
    };
  }

  private createTerrainTiles(): void {
    const radius = TERRAIN_CONFIG.player.tileRadius;
    for (let tileZ = -radius; tileZ <= radius; tileZ += 1) {
      for (let tileX = -radius; tileX <= radius; tileX += 1) {
        for (const [layerIndex, layer] of this.layers.entries()) {
          const mesh = new THREE.Mesh(this.geometry, layer.material);
          mesh.name = `PTL terrain ${layer.kind} ${layer.materialIndex}`;
          mesh.position.set(tileX * TERRAIN_SIZE, 0, tileZ * TERRAIN_SIZE);
          mesh.visible = tileX === 0 && tileZ === 0;
        // Base layers partition the surface exactly, so they are a complete and correct
        // caster. The override layers are coincident geometry at alphaTest 0.005 and would
        // smear a near-solid shadow across their whole bounding area.
        mesh.castShadow = layer.kind === 'base';
        mesh.receiveShadow = true;
          mesh.renderOrder = layer.kind === 'base' ? layer.materialIndex : 20 + layer.materialIndex;
          layer.meshes.push(mesh);
          this.terrainMeshes.push(mesh);
          this.scene.add(mesh);
          if (layerIndex === 0) this.collisionMeshes.push(mesh);
        }
      }
    }
  }

  public get lightingPreset(): TerrainLightingPresetId {
    return this.lighting.currentPreset;
  }

  public get sunElevationDegrees(): number {
    return this.lighting.sunElevationDegrees;
  }

  public setLightingPreset(id: TerrainLightingPresetId): void {
    this.lighting.setPreset(id);
    this.syncFogColor();
    this.render();
  }

  public setSunElevation(degrees: number, quality: 'drag' | 'final'): void {
    this.lighting.setSun({ elevationDegrees: degrees }, quality);
    this.syncFogColor();
    this.render();
  }

  /** Fog has to share the sky's horizon or the terrain edge cuts against the background. */
  private syncFogColor(): void {
    this.playerFog.color.copy(this.lighting.horizonColor);
  }

  /**
   * Spends the shadow map where the viewer is. In player mode that is a tight box just
   * ahead of the camera; in orbit it tracks the zoom, so a close-up gets crisp contact
   * shadows and the 590 m overview gets mountain-scale ones.
   */
  private syncShadowFocus(): void {
    if (this.player.isEngaged) {
      this.camera.getWorldDirection(this.shadowForward);
      this.shadowForward.y = 0;
      if (this.shadowForward.lengthSq() > 1e-8) this.shadowForward.normalize();
      const ahead = metersToUnits(TERRAIN_CONFIG.player.fogStartMeters * 0.4, TERRAIN_SIZE);
      this.shadowFocusPoint.copy(this.camera.position).addScaledVector(this.shadowForward, ahead);
      this.lighting.setShadowFocus(
        this.shadowFocusPoint,
        TERRAIN_CONFIG.lighting.shadowFocusRadiusMeters
      );
      return;
    }
    this.shadowFocusPoint.copy(this.orbitTarget);
    const radius = Math.max(25, Math.min(300, this.orbitDistanceMeters * 0.9));
    this.lighting.setShadowFocus(this.shadowFocusPoint, radius);
  }

  private updateGeometry(fields: Readonly<TerrainFields>): void {
    const segments = TERRAIN_CONFIG.meshSegments;
    const position = this.geometry.attributes.position;
    const normal = this.geometry.attributes.normal;
    if (!(position instanceof THREE.BufferAttribute) || !(normal instanceof THREE.BufferAttribute)) return;
    const sourceStep = Math.max(1, Math.round(fields.resolution / segments));
    const worldStep = TERRAIN_SIZE * sourceStep / fields.resolution;
    const normalScale = TERRAIN_HEIGHT / Math.max(2 * worldStep, 1e-6);
    const scratchNormal = new THREE.Vector3();

    for (let y = 0; y <= segments; y += 1) {
      const sourceY = Math.floor((y / segments) * fields.resolution) % fields.resolution;
      for (let x = 0; x <= segments; x += 1) {
        const sourceX = Math.floor((x / segments) * fields.resolution) % fields.resolution;
        const source = fieldIndex(sourceX, sourceY, fields.resolution);
        const vertex = y * (segments + 1) + x;
        position.setY(vertex, (fields.height[source] ?? 0) * TERRAIN_HEIGHT);

        const left = fields.height[fieldIndex(sourceX - sourceStep, sourceY, fields.resolution)] ?? 0;
        const right = fields.height[fieldIndex(sourceX + sourceStep, sourceY, fields.resolution)] ?? 0;
        const up = fields.height[fieldIndex(sourceX, sourceY - sourceStep, fields.resolution)] ?? 0;
        const down = fields.height[fieldIndex(sourceX, sourceY + sourceStep, fields.resolution)] ?? 0;
        scratchNormal.set((left - right) * normalScale, 1, (down - up) * normalScale).normalize();
        normal.setXYZ(vertex, scratchNormal.x, scratchNormal.y, scratchNormal.z);
      }
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.player.setFields(fields);
    this.riverLayer.update(fields);
    this.gameProps.updateForFields(fields);
  }

  private updateMaterialMasks(
    fields: Readonly<TerrainFields>,
    paint: Readonly<TerrainPaintMask>
  ): void {
    const masks = buildTerrainMaterialMasks(fields, paint);
    for (const layer of this.layers) {
      const values = layer.kind === 'base'
        ? masks.base[layer.materialIndex]
        : masks.override[layer.materialIndex];
      if (values === undefined) continue;
      layer.mask.image = {
        data: maskPixels(values),
        width: fields.resolution,
        height: fields.resolution
      };
      layer.mask.needsUpdate = true;
    }
  }

  private createGpuTextureSet(source: TerrainPbrTextureSet, repeat: number): TerrainGpuTextureSet {
    const textures: THREE.Texture[] = [];
    const create = (channel: TerrainTextureSource | undefined, color: boolean): THREE.Texture | null => {
      if (channel === undefined) return null;
      const texture = new THREE.DataTexture(
        new Uint8Array(channel.pixels),
        channel.width,
        channel.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.flipY = true;
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
      texture.needsUpdate = true;
      textures.push(texture);
      return texture;
    };

    const albedo = create(source.albedo, true);
    if (albedo === null) throw new Error('Terrain material requires an albedo texture.');
    return {
      textures,
      albedo,
      roughness: create(source.roughness, false),
      normal: create(source.normal, false),
      height: create(source.height, false),
      clearcoat: create(source.clearcoat, false),
      clearcoatRoughness: create(source.clearcoatRoughness, false),
      metallic: create(source.metallic, false),
      ao: create(source.ao, false),
      emissive: create(source.emissive, true)
    };
  }

  private applyTextureSet(
    material: THREE.MeshPhysicalMaterial,
    materialIndex: number,
    textures: TerrainGpuTextureSet | null
  ): void {
    if (textures === null) {
      const fallback = TERRAIN_MATERIALS[materialIndex]?.color ?? TERRAIN_MATERIALS[0]!.color;
      material.color.setRGB(fallback[0] / 255, fallback[1] / 255, fallback[2] / 255);
      material.map = null;
      material.roughness = 0.78;
      material.roughnessMap = null;
      material.metalness = 0;
      material.metalnessMap = null;
      material.normalMap = null;
      material.bumpMap = null;
      material.aoMap = null;
      material.clearcoat = 0;
      material.clearcoatMap = null;
      material.clearcoatRoughnessMap = null;
      material.emissive.set(0x000000);
      material.emissiveMap = null;
      material.needsUpdate = true;
      return;
    }

    material.color.set(0xffffff);
    material.map = textures.albedo;
    material.roughness = textures.roughness === null ? 0.78 : 1;
    material.roughnessMap = textures.roughness;
    material.metalness = textures.metallic === null ? 0 : 1;
    material.metalnessMap = textures.metallic;
    material.normalMap = textures.normal;
    material.normalScale.set(1, 1);
    material.bumpMap = textures.normal === null ? textures.height : null;
    material.bumpScale = 0.035;
    material.aoMap = textures.ao;
    material.aoMapIntensity = 1;
    material.clearcoat = textures.clearcoat === null ? 0 : 1;
    material.clearcoatMap = textures.clearcoat;
    material.clearcoatRoughness = textures.clearcoatRoughness === null ? 0.25 : 1;
    material.clearcoatRoughnessMap = textures.clearcoatRoughness;
    material.emissive.set(textures.emissive === null ? 0x000000 : 0xffffff);
    material.emissiveMap = textures.emissive;
    material.emissiveIntensity = 1;
    material.needsUpdate = true;
  }

  private terrainRepeatFor(materialIndex: number): number {
    return this.materialRepeats[materialIndex] ?? TERRAIN_CONFIG.materialRepeat;
  }

  /**
   * One uv unit spans `scale.propReferenceMeters` on every prop, so a wall and the ground
   * beneath it resolve at the same texel density whatever the terrain scale is set to.
   */
  private propRepeatFor(materialIndex: number): number {
    const meters = TERRAIN_CONFIG.worldSize / this.terrainRepeatFor(materialIndex);
    return TERRAIN_CONFIG.scale.propReferenceMeters / meters;
  }

  public setMaterialRepeats(repeats: readonly number[]): void {
    let changed = false;
    for (let index = 0; index < this.materialRepeats.length; index += 1) {
      const next = repeats[index];
      if (next === undefined || !Number.isFinite(next) || next <= 0) continue;
      if (next === this.materialRepeats[index]) continue;
      this.materialRepeats[index] = next;
      changed = true;
    }
    if (!changed) return;
    this.applyRepeats();
  }

  /**
   * Reaches the stashes as well as the live sets. If a scale change skipped them, flipping
   * an A/B comparison would silently compare two different texture scales.
   */
  private applyRepeats(): void {
    const write = (textureSet: TerrainGpuTextureSet, repeat: number): void => {
      for (const texture of textureSet.textures) texture.repeat.set(repeat, repeat);
    };
    for (const [materialIndex, textureSet] of this.materialTextures) {
      write(textureSet, this.terrainRepeatFor(materialIndex));
    }
    for (const [materialIndex, textureSet] of this.propTextureSets) {
      write(textureSet, this.propRepeatFor(materialIndex));
    }
    for (const stash of [this.compareSets, this.previewSets]) {
      for (const [materialIndex, pair] of stash) {
        if (pair === null) continue;
        write(pair.terrain, this.terrainRepeatFor(materialIndex));
        write(pair.prop, this.propRepeatFor(materialIndex));
      }
    }
  }

  private togglePlayerMode(): void {
    if (this.player.currentState === 'idle') {
      if (!this.player.beginPlacement()) {
        this.playerOverlay.setStatus('Generate terrain before entering player mode.');
      }
      return;
    }
    this.player.exit();
  }

  private ensureRenderer(): boolean {
    if (this.renderer !== null) return true;
    if (this.rendererUnavailable) return false;
    const renderer = createOptionalWebGlRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    if (renderer === null) {
      this.rendererUnavailable = true;
      this.playerOverlay.setStatus(WEBGL2_UNAVAILABLE_MESSAGE);
      this.callbacks.onPlayerStatus?.(WEBGL2_UNAVAILABLE_MESSAGE);
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = renderer;
    this.lighting.attachRenderer(renderer);
    this.syncFogColor();
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    for (const textureSet of this.allTextureSets()) {
      for (const texture of textureSet.textures) texture.anisotropy = anisotropy;
    }
    return true;
  }

  private bindInput(): void {
    const signal = this.inputAbort.signal;
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.player.handlePointerDown(event)) return;
      this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    }, { signal });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.player.isEngaged || this.drag === null || this.drag.pointerId !== event.pointerId) return;
      this.yaw -= (event.clientX - this.drag.x) * 0.006;
      this.pitch = Math.max(0.02, Math.min(1.5, this.pitch + (event.clientY - this.drag.y) * 0.005));
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.updateCamera();
    }, { signal });
    const stopDrag = (event: PointerEvent): void => {
      if (this.drag?.pointerId === event.pointerId) this.drag = null;
    };
    this.canvas.addEventListener('pointerup', stopDrag, { signal });
    this.canvas.addEventListener('pointercancel', stopDrag, { signal });
    this.canvas.addEventListener('dblclick', (event) => {
      if (this.player.isEngaged) return;
      const point = this.pickTerrainPoint(event.clientX, event.clientY);
      if (point !== null) this.focusOrbitOn(point);
    }, { signal });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.player.isEngaged) return;
      this.distance = Math.max(
        MIN_DISTANCE,
        Math.min(MAX_DISTANCE, this.distance * Math.exp(event.deltaY * 0.0012))
      );
      this.updateCamera();
    }, { passive: false, signal });
  }

  private handlePlayerStateChange(state: TerrainPlayerState): void {
    const engaged = state !== 'idle';
    this.canvas.classList.toggle('is-player-placement', state === 'placing');
    this.canvas.classList.toggle('is-player-active', state === 'playing' || state === 'paused');
    this.playerOverlay.setState(state);
    if (!engaged) this.playerOverlay.setMaterialReadout(null);
    this.syncRepeatedTiles();
    this.scene.fog = engaged ? this.playerFog : null;
    this.drag = null;
    if (!engaged) {
      this.resetOrbitTarget();
      this.updateCamera();
    } else {
      this.render();
    }
    this.callbacks.onPlayerStateChange?.(state);
    this.callbacks.onPlayerNavigationChange?.();
  }

  private setRepeatedTerrainVisible(visible: boolean): void {
    for (const mesh of this.terrainMeshes) {
      mesh.visible = visible || (mesh.position.x === 0 && mesh.position.z === 0);
    }
    this.gameProps.setRepeatedVisible(visible);
    this.riverLayer.setRepeatedVisible(visible);
  }

  /** Near and far track the orbit distance so a 1 m close-up and a 900 m overview both draw. */
  private applyCameraClipping(): void {
    const near = Math.min(ORBIT_NEAR, Math.max(MIN_NEAR, this.distance * 0.008));
    const far = Math.max(this.distance * 20, MIN_FAR);
    if (this.camera.near === near && this.camera.far === far) return;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  private syncRepeatedTiles(): void {
    this.setRepeatedTerrainVisible(
      this.player.isEngaged || this.distance < REPEATED_TILE_DISTANCE
    );
  }

  /** Orbit distance in metres, for read-outs and the shadow/scale-reference fitting. */
  public get orbitDistanceMeters(): number {
    return unitsToMeters(this.distance, TERRAIN_SIZE);
  }

  private updateCamera(): void {
    if (this.player.isEngaged) return;
    this.applyCameraClipping();
    this.syncRepeatedTiles();
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.orbitTarget.x + Math.sin(this.yaw) * horizontal,
      this.orbitTarget.y + Math.sin(this.pitch) * this.distance,
      this.orbitTarget.z + Math.cos(this.yaw) * horizontal
    );
    this.camera.lookAt(this.orbitTarget);
    this.scaleReference.update(
      this.orbitTarget,
      this.terrainFields,
      TERRAIN_HEIGHT,
      this.orbitDistanceMeters
    );
    this.render();
  }

  private render(): void {
    const renderer = this.renderer;
    if (renderer === null || this.canvas.hidden) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (this.canvas.width !== Math.round(width * renderer.getPixelRatio()) ||
        this.canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.syncShadowFocus();
    this.updateMaterialReadout();
    renderer.render(this.scene, this.camera);
    if (this.player.isEngaged) this.callbacks.onPlayerNavigationChange?.();
  }
}
