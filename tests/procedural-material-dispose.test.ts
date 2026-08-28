import { describe, expect, it } from 'vitest';
import { createDefaultLayer, createDefaultProject } from '../src/app/AppState';
import { createMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { ProceduralMaterial } from '../src/runtime/ProceduralMaterial';

interface GatedCompute {
  compute: { initialize: () => Promise<unknown> };
}

function simulationRecipe(): ReturnType<typeof createMaterialRecipe> {
  const project = createDefaultProject();
  project.layers = [createDefaultLayer('base'), createDefaultLayer('reaction-diffusion')];
  return createMaterialRecipe(project, 7);
}

describe('ProceduralMaterial disposal', () => {
  it('settles prepare() quietly when the host disposes mid-preparation', async () => {
    const runtime = new ProceduralMaterial(simulationRecipe());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Hold the material inside compute.initialize(), the window a host unmounting during
    // preparation actually lands in.
    (runtime as unknown as GatedCompute).compute.initialize = async () => {
      await gate;
      return {};
    };

    const pending = runtime.prepare();
    await Promise.resolve();
    runtime.dispose();
    release();

    // The compute engine rejects any use after dispose, so without the post-initialize check
    // this surfaces as "Material compute engine has been disposed." from the host's own await.
    await expect(pending).resolves.toBeUndefined();
  });

  it('still reports use of a material disposed before prepare()', async () => {
    const runtime = new ProceduralMaterial(simulationRecipe());
    runtime.dispose();

    await expect(runtime.prepare()).rejects.toThrow(/disposed/iu);
  });
});
