import { describe, expect, it } from 'vitest';
import { PTL_MAX_LAYERS } from '../src/core/material/runtimeDefaults';
import { requiredTextureFieldIds } from '../src/core/material/MaterialFieldDependencies';
import { createBakeFragmentGlsl } from '../src/export/TextureBakeShader';
import { MATERIAL_PRESETS } from '../src/materials/presets';

const LAYER_COUNTS = [1, 3, PTL_MAX_LAYERS];

describe('portable shader sampler indexing', () => {
  it('never indexes the sampler array with a runtime value', () => {
    // GLSL ES 1.00 requires a literal constant index into a sampler array. ANGLE rejects a
    // runtime int and a for-loop index alike, which made every portable bake fail to compile.
    for (const layers of LAYER_COUNTS) {
      for (const pass of ['surface', 'displacement'] as const) {
        const source = createBakeFragmentGlsl('portable', layers, pass);
        expect(source).not.toContain('uLabTextureFields[layerIndex]');
        expect(source).not.toContain('uLabTextureFields[i]');
      }
    }
  });

  it('unrolls one preprocessor-guarded branch per possible layer', () => {
    const source = createBakeFragmentGlsl('portable', 3, 'surface');
    for (let layer = 0; layer < PTL_MAX_LAYERS; layer += 1) {
      expect(source).toContain(`#if LAB_MAX_LAYERS > ${layer}`);
      expect(source).toContain(`if (layerIndex == ${layer}) return texture2D(uLabTextureFields[${layer}], uv);`);
    }
    const branches = source.match(/if \(layerIndex == \d+\) return texture2D/gu) ?? [];
    expect(branches).toHaveLength(PTL_MAX_LAYERS);
  });

  it('declares the layer limit before the guarded branches use it', () => {
    // specializeLayerLimit rewrites the directive per bake; if the guards were evaluated before
    // it, every branch would be preprocessed away and texture fields would silently read black.
    for (const layers of LAYER_COUNTS) {
      const source = createBakeFragmentGlsl('portable', layers, 'surface');
      const define = source.indexOf('#define LAB_MAX_LAYERS');
      const texel = source.indexOf('vec4 labTextureFieldTexel');
      expect(define).toBeGreaterThanOrEqual(0);
      expect(texel).toBeGreaterThan(define);
      expect(source).toContain(`#define LAB_MAX_LAYERS ${layers}`);
    }
  });

  it('covers the presets that actually depend on texture fields', () => {
    // Regression guard: the broken shader silently dropped texture fields from most bakes.
    const dependent = MATERIAL_PRESETS.filter((preset) => requiredTextureFieldIds(preset.layers).length > 0);
    expect(dependent.length).toBeGreaterThan(MATERIAL_PRESETS.length / 2);
  });
});
