import { describe, expect, it } from 'vitest';
import {
  SHARED_GLSL,
  SURFACE_VERTEX_DISPLACEMENT_GLSL
} from '../src/materials/PortableProceduralShader';

describe('portable procedural shader', () => {
  it('samples hydrated simulations and exposes recipe-driven SDF controls', () => {
    expect(SHARED_GLSL).toContain('uniform sampler2D uLabSimulationAtlas;');
    expect(SHARED_GLSL).toContain('uLabSimulationReady[layerIndex]');
    expect(SHARED_GLSL).toContain('labSimulationField(layerIndex');
    expect(SHARED_GLSL).toContain('uLabSdfRadius');
    expect(SHARED_GLSL).toContain('uLabSdfBoxSize');
    expect(SHARED_GLSL).toContain('uLabSdfEdgeSoftness');
  });

  it('uses continuous domain variation instead of cell-step offsets', () => {
    expect(SHARED_GLSL).toContain('vec3 warpDomain = position * 0.5');
    expect(SHARED_GLSL).not.toContain('vec3 tile = floor(position * 0.5);');
  });

  it('supports object and world coordinate policies', () => {
    expect(SHARED_GLSL).toContain('uniform int uLabCoordinateSpace;');
    expect(SURFACE_VERTEX_DISPLACEMENT_GLSL).toContain(
      'uLabCoordinateSpace == 0 ? transformed : labPosition'
    );
    expect(SURFACE_VERTEX_DISPLACEMENT_GLSL).toContain('vLabPosition = labSamplePosition;');
    expect(SURFACE_VERTEX_DISPLACEMENT_GLSL).toContain('vLabTriplanarNormal = labTriplanarNormal;');
    expect(SURFACE_VERTEX_DISPLACEMENT_GLSL).toContain('uLabCoordinateSpace != 0');
    expect(SURFACE_VERTEX_DISPLACEMENT_GLSL).toContain('labWorldSamplingNormal');
  });

  it('normal-weights seeded texture fields and combines them by explicit role', () => {
    expect(SHARED_GLSL).toContain('vec3 labTriplanarNormal;');
    expect(SHARED_GLSL).toContain('weights *= step(');
    expect(SHARED_GLSL).toContain('domain * safeScale + seedOffset');
    expect(SHARED_GLSL).toContain('uniform int uLabTextureMode[LAB_MAX_LAYERS];');
    expect(SHARED_GLSL).toContain('if (textureMode == 1) return textureField;');
    expect(SHARED_GLSL).toContain('generatorField * mix(1.0, textureField * 2.0, amount)');
    expect(SHARED_GLSL).toContain('generatorField + (textureField - 0.5) * amount');
    expect(SHARED_GLSL).not.toContain('kind == 14');
  });

  it('rotates texture coordinates before applying non-uniform scale', () => {
    expect(SHARED_GLSL).toContain('vec2 centered = uv - 0.5;');
    expect(SHARED_GLSL).toContain('return rotated * transform.xy + 0.5 + transform.zw;');
  });
});
