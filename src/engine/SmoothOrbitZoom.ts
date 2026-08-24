import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rendererSafetyConfig } from '../config/rendererSafetyConfig';

const MIN_DIRECTION_LENGTH_SQ = 1e-12;

function normalizedWheelPixels(event: WheelEvent, target: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * rendererSafetyConfig.zoom.linePixels;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(target.clientHeight, 1);
  }
  return event.deltaY;
}

export class SmoothOrbitZoom {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly target: HTMLElement;
  private readonly abort = new AbortController();
  private readonly offset = new THREE.Vector3();
  private targetDistance: number | null = null;

  public constructor(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    target: HTMLElement
  ) {
    this.camera = camera;
    this.controls = controls;
    this.target = target;
    this.target.addEventListener('wheel', (event) => this.onWheel(event), {
      capture: true,
      passive: false,
      signal: this.abort.signal
    });
    this.target.addEventListener('pointerdown', () => this.cancel(), {
      capture: true,
      signal: this.abort.signal
    });
  }

  public update(deltaSeconds: number): boolean {
    if (this.targetDistance === null) return false;

    this.offset.copy(this.camera.position).sub(this.controls.target);
    const currentDistance = this.offset.length();
    if (this.offset.lengthSq() <= MIN_DIRECTION_LENGTH_SQ) {
      this.targetDistance = null;
      return false;
    }

    const targetDistance = THREE.MathUtils.clamp(
      this.targetDistance,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    const remaining = targetDistance - currentDistance;
    if (Math.abs(remaining) <= rendererSafetyConfig.zoom.settleDistance) {
      this.setDistance(targetDistance, currentDistance);
      this.targetDistance = null;
      return true;
    }

    const safeDelta = THREE.MathUtils.clamp(deltaSeconds, 0, 0.05);
    const alpha = 1 - Math.exp(-rendererSafetyConfig.zoom.response * safeDelta);
    const nextDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, alpha);
    this.setDistance(nextDistance, currentDistance);
    return true;
  }

  public cancel(): void {
    this.targetDistance = null;
  }

  public dispose(): void {
    this.abort.abort();
    this.targetDistance = null;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();

    const pixels = THREE.MathUtils.clamp(
      normalizedWheelPixels(event, this.target),
      -rendererSafetyConfig.zoom.maxInputPixels,
      rendererSafetyConfig.zoom.maxInputPixels
    );
    if (Math.abs(pixels) <= Number.EPSILON) return;

    const currentDistance = this.currentDistance();
    const baseDistance = this.targetDistance ?? currentDistance;
    const scale = Math.exp(pixels * rendererSafetyConfig.zoom.wheelSensitivity);
    this.targetDistance = THREE.MathUtils.clamp(
      baseDistance * scale,
      this.controls.minDistance,
      this.controls.maxDistance
    );
  }

  private currentDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  private setDistance(distance: number, currentDistance: number): void {
    if (currentDistance <= Number.EPSILON) return;
    this.offset.multiplyScalar(distance / currentDistance);
    this.camera.position.copy(this.controls.target).add(this.offset);
  }
}
