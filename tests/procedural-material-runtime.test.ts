import * as THREE from 'three';
import { MeshSSSNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createDefaultLayer, createDefaultProject } from '../src/app/AppState';
import { createMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { ProceduralMaterial, runtimeSeedOffset } from '../src/runtime/ProceduralMaterial';

describe('ProceduralMaterial runtime', () => {
  it('compiles recipe settings into a WebGPU node material by default', () => {
    const project = createDefaultProject();
    project.physical.metalness = 0.64;
    project.physical.roughness = 0.28;
    project.layers[1]!.displacement = 0.12;
    const runtime = new ProceduralMaterial(createMaterialRecipe(project, 1234));
    try {
      const material = runtime.material;
      expect(material).toBeInstanceOf(MeshSSSNodeMaterial);
      if (!(material instanceof MeshSSSNodeMaterial)) throw new Error('Expected WebGPU node material.');
      expect(material.metalness).toBe(0.64);
      expect(material.roughness).toBe(0.28);
      expect(runtime.displacementExtent).toBeGreaterThan(0);
      expect(runtime.seed).toBe(1234);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps the maximum uint32 recipe seed distinct from zero', () => {
    expect(runtimeSeedOffset(0)).toBe(0);
    expect(runtimeSeedOffset(0xffffffff)).toBeGreaterThan(0);
    expect(runtimeSeedOffset(0xffffffff)).toBeLessThan(100);
  });

  it('retains the GLSL material and displaced shadow adapter for classic WebGLRenderer consumers', () => {
    const runtime = new ProceduralMaterial(
      createMaterialRecipe(createDefaultProject()),
      { backend: 'webgl' }
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const previous = mesh.material;
    try {
      runtime.applyTo(mesh);
      expect(mesh.material).toBe(runtime.material);
      expect(mesh.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
      expect(mesh.customDistanceMaterial).toBeInstanceOf(THREE.MeshDistanceMaterial);
    } finally {
      previous.dispose();
      mesh.geometry.dispose();
      runtime.dispose();
    }
  });

  it('prepares deterministic simulation fields from the recipe', async () => {
    const project = createDefaultProject();
    const reactionDiffusion = createDefaultLayer('reaction-diffusion');
    reactionDiffusion.id = 'reaction';
    reactionDiffusion.seed = 17;
    project.layers = [project.layers[0]!, reactionDiffusion];
    project.selectedLayerId = reactionDiffusion.id;

    const recipe = createMaterialRecipe(project, 91, 'object');
    recipe.algorithms.simulationSize = 16;
    recipe.algorithms.reactionDiffusion.iterations = 4;
    const runtime = new ProceduralMaterial(recipe);
    try {
      await expect(runtime.prepare()).resolves.toBeUndefined();
      expect(runtime.recipe.coordinateSpace).toBe('object');
      runtime.setCoordinateSpace('world');
      runtime.setCoordinateSpace(null);
    } finally {
      runtime.dispose();
    }
  });

  it('updates variants without exposing mutable internal recipe state', () => {
    const runtime = new ProceduralMaterial(createMaterialRecipe(createDefaultProject(), 7));
    try {
      const snapshot = runtime.recipe;
      snapshot.layers[0]!.colorA = '#ffffff';
      runtime.setSeed(99);

      expect(runtime.seed).toBe(99);
      expect(runtime.recipe.layers[0]!.colorA).not.toBe('#ffffff');
      expect(() => runtime.setSeed(-1)).toThrow(/seed must be an integer/u);
      expect(() => runtime.setCoordinateSpace('uv' as never)).toThrow(/unsupported material coordinate space/iu);
    } finally {
      runtime.dispose();
    }
  });

  it('rejects mutations and attachment after disposal', async () => {
    const recipe = createMaterialRecipe(createDefaultProject(), 7);
    const runtime = new ProceduralMaterial(recipe);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const originalMaterial = mesh.material;
    runtime.dispose();

    try {
      expect(() => runtime.setRecipe(recipe)).toThrow(/disposed/iu);
      expect(() => runtime.setSeed(8)).toThrow(/disposed/iu);
      expect(() => runtime.setCoordinateSpace('object')).toThrow(/disposed/iu);
      expect(() => runtime.setWireframe(true)).toThrow(/disposed/iu);
      expect(() => runtime.applyTo(mesh)).toThrow(/disposed/iu);
      await expect(runtime.prepare()).rejects.toThrow(/disposed/iu);
      expect(mesh.material).toBe(originalMaterial);
    } finally {
      originalMaterial.dispose();
      mesh.geometry.dispose();
    }
  });
});
