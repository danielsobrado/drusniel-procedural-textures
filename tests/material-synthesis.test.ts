import { describe, expect, it } from 'vitest';
import { createDefaultProject, createDefaultLayer } from '../src/app/AppState';
import { normalizeProject } from '../src/app/ProjectFile';
import { MaterialComputeEngine } from '../src/engine/MaterialComputeEngine';
import { mutateGenome } from '../src/materials/MaterialGenome';
import { compileMaterialGraph, materialGraphHasCycle } from '../src/core/material/MaterialGraph';

describe('V0.2 material synthesis', () => {
  it('compiles shared structure, masks and outputs into a graph', () => {
    const structure = createDefaultLayer('reaction-diffusion');
    structure.id = 'structure';
    const color = createDefaultLayer('fbm');
    color.id = 'color';
    color.structureSourceLayerId = structure.id;
    color.maskSourceLayerId = structure.id;
    const graph = compileMaterialGraph([structure, color]);
    expect(graph.edges).toContainEqual({ from: 'layer:structure', to: 'layer:color', role: 'structure' });
    expect(graph.edges).toContainEqual({ from: 'layer:structure', to: 'layer:color', role: 'mask' });
    expect(materialGraphHasCycle(graph)).toBe(false);
  });

  it('rejects cyclic structure dependencies in project files', () => {
    const project = createDefaultProject();
    project.layers[0]!.structureSourceLayerId = project.layers[1]!.id;
    project.layers[1]!.structureSourceLayerId = project.layers[0]!.id;
    expect(() => normalizeProject(project)).toThrow(/cyclic material graph/iu);
  });

  it('mutates deterministically and respects locked traits', () => {
    const project = createDefaultProject();
    const locks = { color: true, structure: false, roughness: true, scale: false, damage: true };
    const first = mutateGenome(project.layers, project.synthesis, locks, 9123);
    const second = mutateGenome(project.layers, project.synthesis, locks, 9123);
    expect(first).toEqual(second);
    expect(first.layers[0]!.colorA).toBe(project.layers[0]!.colorA);
    expect(first.layers[0]!.roughness).toBe(project.layers[0]!.roughness);
    expect(first.layers[1]!.scale).not.toBe(project.layers[1]!.scale);
  });

  it('runs repeatable reaction-diffusion fields with histogram analysis', async () => {
    const engine = new MaterialComputeEngine();
    const first = await engine.simulate({ kind: 'reaction-diffusion', size: 16, iterations: 4, seed: 7 });
    const second = await engine.simulate({ kind: 'reaction-diffusion', size: 16, iterations: 4, seed: 7 });
    expect(first.values).toEqual(second.values);
    expect(first.histogram.reduce((sum, value) => sum + value, 0)).toBe(256);
    expect(first.min).toBeGreaterThanOrEqual(0);
    expect(first.max).toBeLessThanOrEqual(1);
  });

  it('runs deterministic periodic erosion fields', async () => {
    const engine = new MaterialComputeEngine();
    const first = await engine.simulate({ kind: 'thermal-erosion', size: 16, iterations: 4, seed: 31 });
    const second = await engine.simulate({ kind: 'thermal-erosion', size: 16, iterations: 4, seed: 31 });
    expect(first.values).toEqual(second.values);
    expect(first.values.every(Number.isFinite)).toBe(true);
    expect(first.min).toBeGreaterThanOrEqual(0);
    expect(first.max).toBeLessThanOrEqual(1);
  });

  it('rejects pathological CPU fallback workloads before blocking the UI thread', async () => {
    const engine = new MaterialComputeEngine();
    await expect(engine.simulate({
      kind: 'thermal-erosion',
      size: 1024,
      iterations: 4096,
      seed: 1
    })).rejects.toThrow(/work budget exceeded/iu);
  });
});
