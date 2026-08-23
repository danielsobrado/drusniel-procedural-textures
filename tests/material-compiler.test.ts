import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MaterialCompiler } from '../src/materials/MaterialCompiler';
import type { MaterialLayer, PhysicalSettings } from '../src/materials/types';

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
    structureSourceLayerId: null,
    maskInvert: false,
    maskStrength: 1,
    ...overrides
  };
}

const PHYSICAL: PhysicalSettings = {
  roughness: 0.27,
  metalness: 0.18,
  clearcoat: 0.42,
  clearcoatRoughness: 0.11,
  specularIntensity: 0.71,
  ior: 1.46,
  sheen: 0.23,
  sheenRoughness: 0.37,
  sheenColor: '#d9c7b8',
  transmission: 0.08,
  thickness: 0.21,
  attenuationDistance: 1.8,
  attenuationColor: '#e8d5c1'
};

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

describe('material backend contract', () => {
  it('keeps separate live and bake materials while recognizing both as procedural', () => {
    const compiler = new MaterialCompiler();
    try {
      expect(compiler.renderMaterial).not.toBe(compiler.material);
      expect(compiler.isProceduralMaterial(compiler.renderMaterial)).toBe(true);
      expect(compiler.isProceduralMaterial(compiler.material)).toBe(true);
      expect(compiler.isProceduralMaterial([compiler.renderMaterial, compiler.material])).toBe(true);
    } finally {
      compiler.dispose();
    }
  });

  it('applies physical settings to both live and bake materials', () => {
    const compiler = new MaterialCompiler();
    try {
      compiler.applyPhysical(PHYSICAL);

      const expected = {
        roughness: PHYSICAL.roughness,
        metalness: PHYSICAL.metalness,
        clearcoat: PHYSICAL.clearcoat,
        clearcoatRoughness: PHYSICAL.clearcoatRoughness,
        transmission: PHYSICAL.transmission,
        thickness: PHYSICAL.thickness
      };
      expect(compiler.material).toMatchObject(expected);
      expect(compiler.renderMaterial).toMatchObject(expected);
    } finally {
      compiler.dispose();
    }
  });

  it('gives bake materials their own simulation texture lifetime', () => {
    const compiler = new MaterialCompiler();
    const source = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
    source.needsUpdate = true;
    let bake: THREE.ShaderMaterial | null = null;
    try {
      compiler.setSimulationAtlas(source, [true], 1);
      bake = compiler.createBakeMaterial(PHYSICAL);
      const snapshot = bake.uniforms.uLabSimulationAtlas?.value;
      expect(snapshot).toBeInstanceOf(THREE.Texture);
      expect(snapshot).not.toBe(source);
      const dispose = vi.spyOn(snapshot as THREE.Texture, 'dispose');
      bake.dispose();
      bake = null;
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      bake?.dispose();
      compiler.dispose();
    }
  });
});
