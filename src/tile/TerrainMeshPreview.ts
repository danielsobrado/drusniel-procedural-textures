import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import {
  createOptionalWebGlRenderer,
  WEBGL2_UNAVAILABLE_MESSAGE
} from '../engine/WebGlRenderer';
import {
  TerrainPlayerController,
  type TerrainPlayerState
} from './TerrainPlayerController';
import { TerrainPlayerOverlay } from './TerrainPlayerOverlay';
import type { TerrainFields } from './TerrainTypes';

const TERRAIN_SIZE = 10;
const TERRAIN_HEIGHT = TERRAIN_SIZE * (TERRAIN_CONFIG.heightScale / TERRAIN_CONFIG.worldSize);
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 18;
const ORBIT_NEAR = 0.1;
const BACKGROUND_COLOR = 0x080b10;

export interface TerrainMeshPreviewCallbacks {
  onPlayerStateChange?: (state: TerrainPlayerState) => void;
  onPlayerStatus?: (message: string) => void;
}

function fieldIndex(x: number, y: number, size: number): number {
  const wrappedX = ((x % size) + size) % size;
  const wrappedY = ((y % size) + size) % size;
  return wrappedY * size + wrappedX;
}

export class TerrainMeshPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, ORBIT_NEAR, 100);
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  private readonly terrainMeshes: THREE.Mesh[] = [];
  private readonly player: TerrainPlayerController;
  private readonly playerOverlay: TerrainPlayerOverlay;
  private readonly playerFog = new THREE.Fog(
    BACKGROUND_COLOR,
    TERRAIN_CONFIG.player.fogStartMeters * TERRAIN_SIZE / TERRAIN_CONFIG.worldSize,
    TERRAIN_CONFIG.player.fogEndMeters * TERRAIN_SIZE / TERRAIN_CONFIG.worldSize
  );
  private readonly observer: ResizeObserver;
  private readonly visibilityObserver: MutationObserver;
  private readonly inputAbort = new AbortController();
  private renderer: THREE.WebGLRenderer | null = null;
  private rendererUnavailable = false;
  private texture: THREE.CanvasTexture | null = null;
  private yaw = 0.72;
  private pitch = 0.78;
  private distance = 11.5;
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
    this.createTerrainTiles();
    this.scene.add(new THREE.HemisphereLight(0xc7d1e8, 0x26221d, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1d2, 2.3);
    sun.position.set(5, 9, 4);
    this.scene.add(sun);
    this.playerOverlay = new TerrainPlayerOverlay(this.canvas, {
      onToggle: () => this.togglePlayerMode()
    });
    this.player = new TerrainPlayerController(
      this.canvas,
      this.camera,
      () => this.terrainMeshes,
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

  public get playerState(): TerrainPlayerState {
    return this.player.currentState;
  }

  public startPlayerPlacement(): boolean {
    return this.player.beginPlacement();
  }

  public exitPlayerMode(): void {
    this.player.exit();
  }

  public update(fields: Readonly<TerrainFields>, surface: HTMLCanvasElement): void {
    if (this.canvas.hidden) return;
    if (!this.ensureRenderer()) return;
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

    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(surface);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.needsUpdate = true;
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    this.render();
  }

  public dispose(): void {
    this.player.dispose();
    this.playerOverlay.dispose();
    this.inputAbort.abort();
    this.observer.disconnect();
    this.visibilityObserver.disconnect();
    this.texture?.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.renderer?.dispose();
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

  private createTerrainTiles(): void {
    const radius = TERRAIN_CONFIG.player.tileRadius;
    for (let tileZ = -radius; tileZ <= radius; tileZ += 1) {
      for (let tileX = -radius; tileX <= radius; tileX += 1) {
        const mesh = new THREE.Mesh(this.geometry, this.material);
        mesh.position.set(tileX * TERRAIN_SIZE, 0, tileZ * TERRAIN_SIZE);
        mesh.visible = tileX === 0 && tileZ === 0;
        this.terrainMeshes.push(mesh);
        this.scene.add(mesh);
      }
    }
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
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;
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
      this.pitch = Math.max(0.28, Math.min(1.28, this.pitch + (event.clientY - this.drag.y) * 0.005));
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.updateCamera();
    }, { signal });
    const stopDrag = (event: PointerEvent): void => {
      if (this.drag?.pointerId === event.pointerId) this.drag = null;
    };
    this.canvas.addEventListener('pointerup', stopDrag, { signal });
    this.canvas.addEventListener('pointercancel', stopDrag, { signal });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.player.isEngaged) return;
      this.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.distance + event.deltaY * 0.008));
      this.updateCamera();
    }, { passive: false, signal });
  }

  private handlePlayerStateChange(state: TerrainPlayerState): void {
    const engaged = state !== 'idle';
    this.canvas.classList.toggle('is-player-placement', state === 'placing');
    this.canvas.classList.toggle('is-player-active', state === 'playing' || state === 'paused');
    this.playerOverlay.setState(state);
    this.setRepeatedTerrainVisible(engaged);
    this.scene.fog = engaged ? this.playerFog : null;
    this.drag = null;
    if (!engaged) {
      this.camera.near = ORBIT_NEAR;
      this.camera.updateProjectionMatrix();
      this.updateCamera();
    } else {
      this.render();
    }
    this.callbacks.onPlayerStateChange?.(state);
  }

  private setRepeatedTerrainVisible(visible: boolean): void {
    for (const mesh of this.terrainMeshes) {
      mesh.visible = visible || (mesh.position.x === 0 && mesh.position.z === 0);
    }
  }

  private updateCamera(): void {
    if (this.player.isEngaged) return;
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * this.distance + TERRAIN_HEIGHT * 0.35,
      Math.cos(this.yaw) * horizontal
    );
    this.camera.lookAt(0, TERRAIN_HEIGHT * 0.35, 0);
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
    renderer.render(this.scene, this.camera);
  }
}
