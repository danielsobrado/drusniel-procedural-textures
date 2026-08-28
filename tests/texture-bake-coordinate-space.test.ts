import { describe, expect, it } from 'vitest';
import { BAKE_VERTEX_GLSL, createBakeFragmentGlsl } from '../src/export/TextureBakeShader';

describe('texture bake coordinate space', () => {
  it('samples object-space materials in local coordinates and world-space materials in world coordinates', () => {
    expect(BAKE_VERTEX_GLSL).toContain('uniform int uLabCoordinateSpace;');
    expect(BAKE_VERTEX_GLSL).toContain(
      'vBakePosition = uLabCoordinateSpace == 0 ? position : worldPosition.xyz;'
    );
  });

  it('provides a coordinate-space-matched bake normal to normal-weighted texture fields', () => {
    expect(BAKE_VERTEX_GLSL).toContain(
      'vBakeTriplanarNormal = uLabCoordinateSpace == 0 ? normalize(normal) : vBakeWorldNormal;'
    );
    expect(createBakeFragmentGlsl('portable', 1, 'surface')).toContain(
      'labTriplanarNormal = normalize(vBakeTriplanarNormal);'
    );
    expect(createBakeFragmentGlsl('portable', 1, 'displacement')).toContain(
      'labTriplanarNormal = normalize(vBakeTriplanarNormal);'
    );
  });
});
