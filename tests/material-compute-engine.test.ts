import { describe, expect, it, vi } from 'vitest';
import {
  MaterialComputeEngine,
  REACTION_DIFFUSION_WGSL
} from '../src/engine/MaterialComputeEngine';

function restoreGpu(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) Reflect.deleteProperty(globalThis.navigator, 'gpu');
  else Object.defineProperty(globalThis.navigator, 'gpu', descriptor);
}

describe('material compute engine', () => {
  it('applies feed to the inhibitor decay in the Gray-Scott update', async () => {
    const engine = new MaterialComputeEngine();
    const common = {
      kind: 'reaction-diffusion' as const,
      size: 8,
      iterations: 2,
      seed: 1,
      reactionDiffusion: {
        kill: 0.05,
        diffusionA: 0.18,
        diffusionB: 0.09
      }
    };

    const lowFeed = await engine.simulate({
      ...common,
      reactionDiffusion: { ...common.reactionDiffusion, feed: 0.01 }
    });
    const highFeed = await engine.simulate({
      ...common,
      reactionDiffusion: { ...common.reactionDiffusion, feed: 0.15 }
    });

    expect(Array.from(highFeed.values)).not.toEqual(Array.from(lowFeed.values));
  });

  it('rejects unsupported simulation kinds at runtime', async () => {
    const engine = new MaterialComputeEngine();
    await expect(engine.simulate({
      kind: 'unknown' as never,
      size: 8,
      iterations: 1,
      seed: 1
    })).rejects.toThrow(/unsupported simulation kind/iu);
  });

  it('retries WebGPU initialization after a transient failure', async () => {
    const originalGpu = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
    let attempts = 0;
    const pipeline = { getBindGroupLayout: () => ({}) };
    const device = {
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => pipeline
    };
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary adapter failure');
          return { requestDevice: async () => device };
        }
      }
    });

    try {
      const engine = new MaterialComputeEngine();
      expect((await engine.initialize()).available).toBe(false);
      expect((await engine.initialize()).available).toBe(true);
      expect(attempts).toBe(2);
      engine.dispose();
    } finally {
      restoreGpu(originalGpu);
    }
  });

  it('destroys an initialized WebGPU device on dispose', async () => {
    const originalGpu = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
    const destroy = vi.fn();
    const pipeline = { getBindGroupLayout: () => ({}) };
    const device = {
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => pipeline,
      destroy
    };
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({ requestDevice: async () => device })
      }
    });

    try {
      const engine = new MaterialComputeEngine();
      expect((await engine.initialize()).available).toBe(true);
      expect(engine.cachedPipelineCount).toBe(1);

      engine.dispose();

      expect(destroy).toHaveBeenCalledOnce();
      expect(engine.cachedPipelineCount).toBe(0);
      expect(engine.status.available).toBe(false);
      await expect(engine.initialize()).rejects.toThrow(/disposed/iu);
    } finally {
      restoreGpu(originalGpu);
    }
  });

  it('does not resurrect a WebGPU device when initialization finishes after dispose', async () => {
    const originalGpu = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
    const destroy = vi.fn();
    const pipeline = { getBindGroupLayout: () => ({}) };
    const device = {
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => pipeline,
      destroy
    };
    let resolveDevice!: (value: typeof device) => void;
    const devicePromise = new Promise<typeof device>((resolve) => { resolveDevice = resolve; });
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({ requestDevice: () => devicePromise })
      }
    });

    try {
      const engine = new MaterialComputeEngine();
      const initialization = engine.initialize();
      await Promise.resolve();
      engine.dispose();
      resolveDevice(device);

      expect((await initialization).available).toBe(false);
      expect(destroy).toHaveBeenCalledOnce();
      expect(engine.cachedPipelineCount).toBe(0);
      expect(engine.status.available).toBe(false);
    } finally {
      restoreGpu(originalGpu);
    }
  });

  it('invalidates cached compute state when the WebGPU device is lost', async () => {
    const originalGpu = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
    const pipeline = { getBindGroupLayout: () => ({}) };
    let resolveLost!: () => void;
    const lost = new Promise<void>((resolve) => { resolveLost = resolve; });
    const device = {
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => pipeline,
      lost
    };
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: async () => ({ requestDevice: async () => device })
      }
    });

    try {
      const engine = new MaterialComputeEngine();
      expect((await engine.initialize()).available).toBe(true);
      expect(engine.cachedPipelineCount).toBe(1);

      resolveLost();
      await lost;
      await Promise.resolve();

      expect(engine.status.available).toBe(false);
      expect(engine.cachedPipelineCount).toBe(0);
      engine.dispose();
    } finally {
      restoreGpu(originalGpu);
    }
  });

  it('keeps the WebGPU equation aligned with the CPU Gray-Scott update', () => {
    expect(REACTION_DIFFUSION_WGSL).toContain(
      'reaction - (params.feed + params.kill) * state.y'
    );
  });

  it('does not use reserved WGSL identifiers for storage buffers', () => {
    expect(REACTION_DIFFUSION_WGSL).toContain(
      'var<storage, read_write> nextState: array<vec2f>;'
    );
    expect(REACTION_DIFFUSION_WGSL).not.toMatch(
      /var<storage, read_write> target:/
    );
  });
});
