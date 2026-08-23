import type { FixedQualityTier, PerformanceStats, QualityTier } from './Quality';

interface RendererStatsSource {
  info: {
    render: {
      calls: number;
      drawCalls?: number;
      triangles: number;
    };
    memory: {
      geometries: number;
      textures: number;
    };
  };
}

export class PerformanceProfiler {
  private windowStart = performance.now();
  private previousFrame = this.windowStart;
  private frameCount = 0;
  private frameTimeTotal = 0;

  public constructor(private readonly sampleIntervalMs: number) {}

  public reset(now = performance.now()): void {
    this.windowStart = now;
    this.previousFrame = now;
    this.frameCount = 0;
    this.frameTimeTotal = 0;
  }

  public sample(
    renderer: RendererStatsSource,
    requestedTier: QualityTier,
    activeTier: FixedQualityTier
  ): PerformanceStats | null {
    const now = performance.now();
    const frameTime = Math.max(now - this.previousFrame, 0);
    this.previousFrame = now;
    this.frameCount += 1;
    this.frameTimeTotal += frameTime;

    const elapsed = now - this.windowStart;
    if (elapsed < this.sampleIntervalMs) return null;

    const stats: PerformanceStats = {
      fps: elapsed > 0 ? this.frameCount * 1000 / elapsed : 0,
      frameMs: this.frameCount > 0 ? this.frameTimeTotal / this.frameCount : 0,
      drawCalls: renderer.info.render.drawCalls ?? renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      requestedTier,
      activeTier
    };

    this.reset(now);
    return stats;
  }
}
