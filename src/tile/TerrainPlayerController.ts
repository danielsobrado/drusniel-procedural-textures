import * as THREE from 'three';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { TerrainFields } from './TerrainTypes';

export type TerrainPlayerState = 'idle' | 'placing' | 'playing' | 'paused';

interface TerrainPlayerCallbacks {
  onRender: () => void;
  onStateChange?: (state: TerrainPlayerState) => void;
  onStatus?: (message: string) => void;
}

function wrapIndex(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function sourceIndexForVertex(vertex: number, segments: number, resolution: number): number {
  return wrapIndex(Math.floor((vertex / segments) * resolution), resolution);
}

export function wrapTerrainCoordinate(value: number, terrainSize: number): number {
  return THREE.MathUtils.euclideanModulo(value + terrainSize * 0.5, terrainSize) - terrainSize * 0.5;
}

export function sampleTerrainHeight(
  fields: Readonly<TerrainFields>,
  worldX: number,
  worldZ: number,
  terrainSize: number,
  terrainHeight: number,
  segments = fields.resolution
): number {
  const resolution = fields.resolution;
  if (resolution <= 0 || segments <= 0 || fields.height.length < resolution * resolution) return 0;

  const u = THREE.MathUtils.euclideanModulo(worldX / terrainSize + 0.5, 1);
  const v = THREE.MathUtils.euclideanModulo(worldZ / terrainSize + 0.5, 1);
  const gridX = u * segments;
  const gridY = v * segments;
  const cellX = Math.floor(gridX);
  const cellY = Math.floor(gridY);
  const tx = gridX - cellX;
  const ty = gridY - cellY;
  const x0 = sourceIndexForVertex(cellX, segments, resolution);
  const x1 = sourceIndexForVertex(cellX + 1, segments, resolution);
  const y0 = sourceIndexForVertex(cellY, segments, resolution);
  const y1 = sourceIndexForVertex(cellY + 1, segments, resolution);
  const h00 = fields.height[y0 * resolution + x0] ?? 0;
  const h10 = fields.height[y0 * resolution + x1] ?? 0;
  const h01 = fields.height[y1 * resolution + x0] ?? 0;
  const h11 = fields.height[y1 * resolution + x1] ?? 0;

  const height = tx + ty <= 1
    ? h00 * (1 - tx - ty) + h10 * tx + h01 * ty
    : h11 * (tx + ty - 1) + h10 * (1 - ty) + h01 * (1 - tx);
  return height * terrainHeight;
}

export class TerrainPlayerController {
  private readonly inputAbort = new AbortController();
  private readonly keys = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly direction = new THREE.Vector3();
  private fields: Readonly<TerrainFields> | null = null;
  private state: TerrainPlayerState = 'idle';
  private active = false;
  private placing = false;
  private yaw = 0;
  private pitch = 0;
  private animationFrame = 0;
  private lastFrameAt = 0;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrainObjects: () => readonly THREE.Object3D[],
    private readonly terrainSize: number,
    private readonly terrainHeight: number,
    private readonly callbacks: Readonly<TerrainPlayerCallbacks>
  ) {
    this.bindInput();
  }

  public get currentState(): TerrainPlayerState {
    return this.state;
  }

  public get isEngaged(): boolean {
    return this.active || this.placing;
  }

  public setFields(fields: Readonly<TerrainFields>): void {
    this.fields = fields;
    if (this.active) this.snapToGround();
  }

  public beginPlacement(): boolean {
    if (this.fields === null) return false;
    this.active = false;
    this.placing = true;
    this.keys.clear();
    this.stopLoop();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.setState('placing');
    this.callbacks.onStatus?.('Player placement · click a point on the terrain to spawn.');
    return true;
  }

  public exit(): void {
    this.active = false;
    this.placing = false;
    this.keys.clear();
    this.stopLoop();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.setState('idle');
  }

  public handlePointerDown(event: PointerEvent): boolean {
    if (this.placing) {
      event.preventDefault();
      this.placePlayer(event);
      return true;
    }
    if (!this.active) return false;
    event.preventDefault();
    this.requestPointerLock();
    return true;
  }

  public dispose(): void {
    this.exit();
    this.inputAbort.abort();
  }

  private bindInput(): void {
    const signal = this.inputAbort.signal;
    document.addEventListener('pointerlockchange', () => this.handlePointerLockChange(), { signal });
    document.addEventListener('mousemove', (event) => this.handleMouseMove(event), { signal });
    document.addEventListener('keydown', (event) => this.handleKey(event, true), { signal });
    document.addEventListener('keyup', (event) => this.handleKey(event, false), { signal });
    window.addEventListener('blur', () => this.keys.clear(), { signal });
  }

  private placePlayer(event: PointerEvent): void {
    const fields = this.fields;
    if (fields === null) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.terrainObjects()], false)[0];
    if (hit === undefined) {
      this.callbacks.onStatus?.('Player placement missed the terrain · click directly on the terrain surface.');
      return;
    }

    this.camera.getWorldDirection(this.direction);
    this.yaw = Math.atan2(-this.direction.x, -this.direction.z);
    // Preserve the orbit heading, but spawn at eye level instead of inheriting
    // the overview camera's steep downward pitch.
    this.pitch = 0;
    this.camera.rotation.order = 'YXZ';
    this.camera.position.x = wrapTerrainCoordinate(hit.point.x, this.terrainSize);
    this.camera.position.z = wrapTerrainCoordinate(hit.point.z, this.terrainSize);
    this.active = true;
    this.placing = false;
    this.snapToGround();
    this.updateLook();
    this.camera.near = Math.max(
      0.001,
      TERRAIN_CONFIG.player.nearClipMeters * this.terrainSize / TERRAIN_CONFIG.worldSize
    );
    this.camera.updateProjectionMatrix();
    this.setState('paused');
    this.requestPointerLock();
  }

  private requestPointerLock(): void {
    if (!this.active || document.pointerLockElement === this.canvas) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result instanceof Promise) {
        void result.catch((error: unknown) => {
          console.warn('Terrain player pointer lock was rejected.', error);
          this.callbacks.onStatus?.('Player ready · click the 3D view to capture the mouse.');
        });
      }
    } catch (error) {
      console.warn('Terrain player pointer lock failed.', error);
      this.callbacks.onStatus?.('Player ready · click the 3D view to capture the mouse.');
    }
  }

  private handlePointerLockChange(): void {
    if (!this.active) return;
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) {
      this.setState('playing');
      this.callbacks.onStatus?.('Player mode · WASD move · Shift sprint · mouse look · Esc releases the mouse.');
      this.startLoop();
      return;
    }
    this.stopLoop();
    this.setState('paused');
    this.callbacks.onStatus?.('Player paused · click the 3D view to resume · Player button exits.');
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    const sensitivity = TERRAIN_CONFIG.player.mouseSensitivity;
    const maxPitch = THREE.MathUtils.degToRad(TERRAIN_CONFIG.player.maxPitchDegrees);
    this.yaw -= event.movementX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * sensitivity, -maxPitch, maxPitch);
    this.updateLook();
    this.callbacks.onRender();
  }

  private handleKey(event: KeyboardEvent, pressed: boolean): void {
    if (!this.active || document.pointerLockElement !== this.canvas) return;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) return;
    event.preventDefault();
    if (pressed) this.keys.add(event.code);
    else this.keys.delete(event.code);
  }

  private startLoop(): void {
    if (this.animationFrame !== 0 || document.pointerLockElement !== this.canvas) return;
    this.lastFrameAt = performance.now();
    const tick = (now: number): void => {
      if (!this.active || document.pointerLockElement !== this.canvas) {
        this.animationFrame = 0;
        return;
      }
      const deltaSeconds = Math.min(Math.max((now - this.lastFrameAt) / 1000, 0), 0.05);
      this.lastFrameAt = now;
      this.updateMovement(deltaSeconds);
      this.callbacks.onRender();
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.animationFrame === 0) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  private updateMovement(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    const forwardInput = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const rightInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    if (forwardInput === 0 && rightInput === 0) {
      this.snapToGround();
      return;
    }

    const inputLength = Math.hypot(forwardInput, rightInput);
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const worldSpeed = TERRAIN_CONFIG.player.walkSpeedMetersPerSecond *
      (sprinting ? TERRAIN_CONFIG.player.sprintMultiplier : 1);
    const previewSpeed = worldSpeed * this.terrainSize / TERRAIN_CONFIG.worldSize;
    const distance = previewSpeed * deltaSeconds / inputLength;

    this.camera.position.x = wrapTerrainCoordinate(
      this.camera.position.x + (forwardX * forwardInput + rightX * rightInput) * distance,
      this.terrainSize
    );
    this.camera.position.z = wrapTerrainCoordinate(
      this.camera.position.z + (forwardZ * forwardInput + rightZ * rightInput) * distance,
      this.terrainSize
    );
    this.snapToGround();
  }

  private snapToGround(): void {
    const fields = this.fields;
    if (fields === null) return;
    const eyeHeight = TERRAIN_CONFIG.player.eyeHeightMeters * this.terrainSize / TERRAIN_CONFIG.worldSize;
    this.camera.position.y = sampleTerrainHeight(
      fields,
      this.camera.position.x,
      this.camera.position.z,
      this.terrainSize,
      this.terrainHeight,
      TERRAIN_CONFIG.meshSegments
    ) + eyeHeight;
  }

  private updateLook(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private setState(state: TerrainPlayerState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }
}
