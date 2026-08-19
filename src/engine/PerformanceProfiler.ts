import type * as THREE from 'three';
import type { FixedQualityTier, PerformanceStats, QualityTier } from './Quality';

export class PerformanceProfiler {
  private windowStart = performance.now();
  private previousFrame = this.windowStart;
  private frameCount = 0;
  private frameTimeTotal = 0;

  public constructor(private readonly sampleIntervalMs: number) {}

  public sample(
    renderer: THREE.WebGLRenderer,
    requestedTier: QualityTier,
    activeTier: FixedQualityTier
  ): PerformanceStats | null {
    const now = performance.now();
    const frameTime = Math.max(now - this.previousFrame, 0);
    this.previousFrame = now;
    this.frameCount += 1;
    this.frameTimeTotal += frameTime;

    const elapsed = now - this.windowStart;
    if (elapsed < this.sampleIntervalMs) {
      return null;
    }

    const stats: PerformanceStats = {
      fps: elapsed > 0 ? this.frameCount * 1000 / elapsed : 0,
      frameMs: this.frameCount > 0 ? this.frameTimeTotal / this.frameCount : 0,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      requestedTier,
      activeTier
    };

    this.windowStart = now;
    this.frameCount = 0;
    this.frameTimeTotal = 0;
    return stats;
  }
}
