import { describe, expect, it } from 'vitest';
import { SHARED_GLSL as BASE_SHARED_GLSL } from '../src/materials/ProceduralShader';
import { SHARED_GLSL as PORTABLE_SHARED_GLSL } from '../src/materials/PortableProceduralShader';
import { webGpuTopologyFingerprint } from '../src/materials/WebGpuSurfaceDesignerNodes';
import { createPresetLayer } from '../src/materials/presetLayer';
import type { MaterialLayer } from '../src/core/material/RuntimeMaterial';

function layers(maskMode: MaterialLayer['maskMode']): MaterialLayer[] {
  return [
    createPresetLayer('bricks', 'Bricks', 'pattern', { displacement: 0.026 }),
    createPresetLayer('moss', 'Moss', 'fbm', { maskSourceLayerId: 'bricks', maskMode })
  ];
}

describe('height mask parity across evaluators', () => {
  it('carries the relief and height mask helpers into the portable shader', () => {
    expect(PORTABLE_SHARED_GLSL).toContain('float labReliefForLayer(int layerIndex, vec3 position)');
    expect(PORTABLE_SHARED_GLSL).toContain('float labHeightMask(int layerIndex, int maskIndex, vec3 position)');
    expect(PORTABLE_SHARED_GLSL).toContain('if (uLabMaskMode[layerIndex] > 0.5) {');
  });

  it('specializes the zero-baseline classification for pattern layers in the portable shader', () => {
    expect(BASE_SHARED_GLSL).toContain('return kind == 4 || kind == 5 || kind == 7;');
    expect(PORTABLE_SHARED_GLSL).toContain('return kind == 4 || kind == 5 || kind == 7 || kind == 13;');
    expect(PORTABLE_SHARED_GLSL).not.toContain('return kind == 4 || kind == 5 || kind == 7;');
  });

  it('declares the height mask uniforms in the portable shader', () => {
    for (const name of ['uLabMaskMode', 'uLabMaskThreshold', 'uLabMaskSoftness', 'uLabMaskBreakup']) {
      expect(PORTABLE_SHARED_GLSL).toContain(`uniform float ${name}[LAB_MAX_LAYERS];`);
    }
  });

  it('rebuilds the WebGPU node graph when mask mode changes', () => {
    const coverage = webGpuTopologyFingerprint(layers('coverage'), 'world', [true, true]);
    const height = webGpuTopologyFingerprint(layers('height'), 'world', [true, true]);
    expect(coverage).not.toEqual(height);
  });

  it('keeps the fingerprint stable for two identical layer sets', () => {
    expect(webGpuTopologyFingerprint(layers('height'), 'world', [true, true]))
      .toEqual(webGpuTopologyFingerprint(layers('height'), 'world', [true, true]));
  });
});
