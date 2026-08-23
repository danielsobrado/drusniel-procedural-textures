import { describe, expect, it } from 'vitest';
import {
  MaterialComputeEngine,
  REACTION_DIFFUSION_WGSL
} from '../src/engine/MaterialComputeEngine';

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
    } finally {
      if (originalGpu === undefined) Reflect.deleteProperty(globalThis.navigator, 'gpu');
      else Object.defineProperty(globalThis.navigator, 'gpu', originalGpu);
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
