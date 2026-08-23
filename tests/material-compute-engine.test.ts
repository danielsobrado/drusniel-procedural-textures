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
