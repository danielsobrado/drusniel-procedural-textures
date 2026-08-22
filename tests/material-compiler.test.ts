import { describe, expect, it } from 'vitest';
import { MaterialCompiler } from '../src/materials/MaterialCompiler';
import type { MaterialLayer } from '../src/materials/types';

function layer(overrides: Partial<MaterialLayer>): MaterialLayer {
  return {
    id: 'layer-test',
    name: 'Test layer',
    kind: 'fbm',
    enabled: true,
    blendMode: 'normal',
    channel: 'height',
    opacity: 1,
    scale: 1,
    strength: 1,
    seed: 1,
    colorA: '#000000',
    colorB: '#ffffff',
    roughness: 0,
    displacement: 0.1,
    groupId: null,
    maskSourceLayerId: null,
    maskInvert: false,
    maskStrength: 1,
    ...overrides
  };
}

describe('material displacement bounds', () => {
  it('keeps the full one-sided range for sparse displacement fields', () => {
    const compiler = new MaterialCompiler();
    try {
      compiler.sync([layer({ kind: 'veins', displacement: -0.18 })], [], false);
      expect(compiler.displacementExtent).toBeCloseTo(0.18);
    } finally {
      compiler.dispose();
    }
  });

  it('uses the half-range bound for centered displacement fields', () => {
    const compiler = new MaterialCompiler();
    try {
      compiler.sync([layer({ kind: 'fbm', displacement: 0.18 })], [], false);
      expect(compiler.displacementExtent).toBeCloseTo(0.09);
    } finally {
      compiler.dispose();
    }
  });
});
