import { describe, expect, it } from 'vitest';
import {
  materialHeightMask,
  materialLayerRelief,
  PTL_MASK_SOFTNESS_FLOOR
} from '../src/core/material/MaterialRelief';
import { normalizeRuntimeMaterialDefinition } from '../src/core/material/RuntimeMaterialSchema';
import { createPresetLayer } from '../src/materials/presetLayer';
import { PTL_DEFAULT_PHYSICAL, PTL_DEFAULT_SYNTHESIS } from '../src/core/material/runtimeDefaults';
import { SHARED_GLSL } from '../src/materials/ProceduralShader';
import { MaterialCompiler } from '../src/materials/MaterialCompiler';

function definitionWith(overrides: Record<string, unknown>) {
  return {
    physical: PTL_DEFAULT_PHYSICAL,
    synthesis: PTL_DEFAULT_SYNTHESIS,
    groups: [],
    layers: [
      createPresetLayer('bricks', 'Bricks', 'pattern', { displacement: 0.026 }),
      createPresetLayer('moss', 'Moss', 'fbm', { maskSourceLayerId: 'bricks', ...overrides })
    ]
  };
}

describe('height mask', () => {
  it('opens below the threshold and closes above it', () => {
    const threshold = 0.5;
    const softness = 0.15;
    expect(materialHeightMask(0.2, threshold, softness)).toBe(0);
    expect(materialHeightMask(0.8, threshold, softness)).toBe(1);
    expect(materialHeightMask(0.5, threshold, softness)).toBeCloseTo(0.5, 10);
  });

  it('narrows the transition as softness falls', () => {
    const wide = materialHeightMask(0.55, 0.5, 0.4);
    const narrow = materialHeightMask(0.55, 0.5, 0.08);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('never receives a degenerate edge pair when softness is zero', () => {
    expect(materialHeightMask(0.5 - PTL_MASK_SOFTNESS_FLOOR * 2, 0.5, 0)).toBe(0);
    expect(materialHeightMask(0.5 + PTL_MASK_SOFTNESS_FLOOR * 2, 0.5, 0)).toBe(1);
    expect(Number.isNaN(materialHeightMask(0.5, 0.5, 0))).toBe(false);
  });

  it('places moss in the mortar when inverted against brick relief', () => {
    const brickFace = materialLayerRelief('pattern', 0.95, 0.026);
    const mortarGap = materialLayerRelief('pattern', 0.05, 0.026);

    const onFace = 1 - materialHeightMask(brickFace, 0.5, 0.15);
    const inGap = 1 - materialHeightMask(mortarGap, 0.5, 0.15);

    expect(inGap).toBeGreaterThan(0.9);
    expect(onFace).toBeLessThan(0.1);
  });

  it('branches on mask mode in the base shader without disturbing coverage mode', () => {
    expect(SHARED_GLSL).toContain('float labHeightMask(int layerIndex, int maskIndex, vec3 position)');
    expect(SHARED_GLSL).toContain('if (uLabMaskMode[layerIndex] > 0.5) {');
    expect(SHARED_GLSL).toContain('shaped = labHeightMask(layerIndex, maskIndex, position);');
    expect(SHARED_GLSL).toContain('shaped = labShapeField(field, uLabStrength[maskIndex]);');
    expect(SHARED_GLSL).toContain('return smoothstep(threshold - softness, threshold + softness, relief);');
  });

  it('declares the height mask uniforms', () => {
    for (const name of ['uLabMaskMode', 'uLabMaskThreshold', 'uLabMaskSoftness', 'uLabMaskBreakup']) {
      expect(SHARED_GLSL).toContain(`uniform float ${name}[LAB_MAX_LAYERS];`);
    }
  });

  it('defaults an absent mask mode to coverage so existing recipes are unchanged', () => {
    const normalized = normalizeRuntimeMaterialDefinition(definitionWith({}));
    const moss = normalized.layers[1]!;
    expect(moss.maskMode).toBe('coverage');
    expect(moss.maskThreshold).toBe(0.5);
    expect(moss.maskSoftness).toBe(0.15);
    expect(moss.maskBreakup).toBe(0);
  });

  it('round-trips every height mask field', () => {
    const normalized = normalizeRuntimeMaterialDefinition(definitionWith({
      maskMode: 'height',
      maskThreshold: 0.32,
      maskSoftness: 0.08,
      maskBreakup: 0.4
    }));
    const moss = normalized.layers[1]!;
    expect(moss.maskMode).toBe('height');
    expect(moss.maskThreshold).toBe(0.32);
    expect(moss.maskSoftness).toBe(0.08);
    expect(moss.maskBreakup).toBe(0.4);
  });

  it('syncs the height mask uniforms from the compiled layer stack', () => {
    const compiler = new MaterialCompiler();
    try {
      const normalized = normalizeRuntimeMaterialDefinition(definitionWith({
        maskMode: 'height',
        maskThreshold: 0.32,
        maskSoftness: 0.08,
        maskBreakup: 0.4
      }));
      compiler.sync(normalized.layers, [], false, normalized.synthesis);
      const uniforms = compiler.uniforms as Record<string, { value: number[] }>;

      expect(uniforms.uLabMaskMode!.value[0]).toBe(0);
      expect(uniforms.uLabMaskMode!.value[1]).toBe(1);
      expect(uniforms.uLabMaskThreshold!.value[1]).toBe(0.32);
      expect(uniforms.uLabMaskSoftness!.value[1]).toBe(0.08);
      expect(uniforms.uLabMaskBreakup!.value[1]).toBe(0.4);
    } finally {
      compiler.dispose();
    }
  });

  it('rejects an unsupported mask mode and out-of-range shaping values', () => {
    expect(() => normalizeRuntimeMaterialDefinition(definitionWith({ maskMode: 'depth' })))
      .toThrow(/mask mode/i);
    expect(() => normalizeRuntimeMaterialDefinition(definitionWith({ maskThreshold: 1.4 })))
      .toThrow(/mask threshold/i);
    expect(() => normalizeRuntimeMaterialDefinition(definitionWith({ maskSoftness: -0.2 })))
      .toThrow(/mask softness/i);
    expect(() => normalizeRuntimeMaterialDefinition(definitionWith({ maskBreakup: 2 })))
      .toThrow(/mask breakup/i);
  });
});
