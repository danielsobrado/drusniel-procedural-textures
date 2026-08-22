import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceProfiler } from '../src/engine/PerformanceProfiler';

const renderer = {
  info: {
    render: { calls: 2, triangles: 12 },
    memory: { geometries: 3, textures: 4 }
  }
} as unknown as THREE.WebGLRenderer;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('performance profiler', () => {
  it('drops warmup time when its sample window is reset', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    const profiler = new PerformanceProfiler(100);

    now.mockReturnValue(5000);
    profiler.reset();
    now.mockReturnValue(5100);

    const stats = profiler.sample(renderer, 'high', 'high');
    expect(stats?.fps).toBeCloseTo(10);
    expect(stats?.frameMs).toBeCloseTo(100);
    expect(stats?.drawCalls).toBe(2);
  });
});
