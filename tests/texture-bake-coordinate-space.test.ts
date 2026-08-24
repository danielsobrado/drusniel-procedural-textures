import { describe, expect, it } from 'vitest';
import { BAKE_VERTEX_GLSL } from '../src/export/TextureBakeShader';

describe('texture bake coordinate space', () => {
  it('samples object-space materials in local coordinates and world-space materials in world coordinates', () => {
    expect(BAKE_VERTEX_GLSL).toContain('uniform int uLabCoordinateSpace;');
    expect(BAKE_VERTEX_GLSL).toContain(
      'vBakePosition = uLabCoordinateSpace == 0 ? position : worldPosition.xyz;'
    );
  });
});
