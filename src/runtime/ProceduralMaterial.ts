import * as THREE from 'three';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { MaterialComputeEngine } from '../engine/MaterialComputeEngine';
import { buildMaterialSimulationAtlas } from '../engine/SimulationAtlas';
import { applyPhysicalSettings } from '../materials/PhysicalMaterial';
import { SurfaceMaterialCompiler } from '../materials/SurfaceMaterialCompiler';
import type { MaterialLayer } from '../materials/types';
import { parseMaterialRecipe, type MaterialRecipe } from './MaterialRecipe';

export interface ProceduralMaterialOptions {
  wireframe?: boolean;
  coordinateSpace?: MaterialCoordinateSpace;
}

function seedOffset(seed: number): number {
  if (seed === 0) return 0;
  return (Math.imul(seed, 0x9e37_79b1) >>> 0) / 0xffff_ffff * 100;
}

function variantLayers(
  layers: readonly MaterialLayer[],
  recipeSeed: number
): MaterialLayer[] {
  const offset = seedOffset(recipeSeed);
  if (offset === 0) return layers.map((layer) => ({ ...layer }));
  return layers.map((layer) => ({
    ...layer,
    seed: (layer.seed + offset) % 100
  }));
}

/**
 * Lightweight Three.js runtime for a portable PTL material recipe.
 * Call `prepare()` to hydrate reaction-diffusion and erosion fields before use.
 */
export class ProceduralMaterial {
  private readonly compiler = new SurfaceMaterialCompiler();
  private readonly compute = new MaterialComputeEngine();
  private recipeValue: MaterialRecipe;
  private wireframeValue: boolean;
  private coordinateSpaceOverride: MaterialCoordinateSpace | null;
  private preparationSequence = 0;
  private disposed = false;

  public constructor(recipe: unknown, options: Readonly<ProceduralMaterialOptions> = {}) {
    this.recipeValue = parseMaterialRecipe(recipe);
    this.wireframeValue = options.wireframe ?? false;
    this.coordinateSpaceOverride = options.coordinateSpace ?? null;
    this.sync();
    this.compiler.material.name = 'PTL Procedural Material';
    this.compiler.depthMaterial.name = 'PTL Procedural Depth';
    this.compiler.distanceMaterial.name = 'PTL Procedural Distance';
  }

  public get material(): THREE.MeshPhysicalMaterial {
    return this.compiler.material;
  }

  public get depthMaterial(): THREE.MeshDepthMaterial {
    return this.compiler.depthMaterial;
  }

  public get distanceMaterial(): THREE.MeshDistanceMaterial {
    return this.compiler.distanceMaterial;
  }

  public get recipe(): MaterialRecipe {
    return parseMaterialRecipe(this.recipeValue);
  }

  public get seed(): number {
    return this.recipeValue.seed;
  }

  public get displacementExtent(): number {
    return this.compiler.displacementExtent;
  }

  public async prepare(): Promise<void> {
    if (this.disposed) throw new Error('Procedural material has been disposed.');
    const sequence = ++this.preparationSequence;
    await this.compute.initialize();
    const layers = variantLayers(this.recipeValue.layers, this.recipeValue.seed);
    const atlas = await buildMaterialSimulationAtlas(
      this.compute,
      layers,
      this.recipeValue.algorithms
    );
    if (this.disposed || sequence !== this.preparationSequence) {
      atlas?.texture.dispose();
      return;
    }
    this.compiler.setSimulationAtlas(
      atlas?.texture ?? null,
      atlas?.readyLayers ?? [],
      atlas?.cellSize ?? 1
    );
  }

  public setRecipe(recipe: unknown): void {
    this.recipeValue = parseMaterialRecipe(recipe);
    this.invalidateSimulation();
    this.sync();
  }

  public setSeed(seed: number): void {
    this.recipeValue = parseMaterialRecipe({ ...this.recipeValue, seed });
    this.invalidateSimulation();
    this.sync();
  }

  public setCoordinateSpace(coordinateSpace: MaterialCoordinateSpace | null): void {
    if (coordinateSpace !== null && coordinateSpace !== 'object' && coordinateSpace !== 'world') {
      throw new Error(`Unsupported material coordinate space: ${String(coordinateSpace)}.`);
    }
    this.coordinateSpaceOverride = coordinateSpace;
    this.sync();
  }

  public setWireframe(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Wireframe must be a boolean.');
    this.wireframeValue = enabled;
    this.sync();
  }

  public applyTo(mesh: THREE.Mesh): void {
    mesh.material = this.material;
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.customDistanceMaterial = this.distanceMaterial;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparationSequence += 1;
    this.compiler.dispose();
  }

  private invalidateSimulation(): void {
    this.preparationSequence += 1;
    this.compiler.setSimulationAtlas(null);
  }

  private sync(): void {
    const layers = variantLayers(this.recipeValue.layers, this.recipeValue.seed);
    this.compiler.setAlgorithmSettings(this.recipeValue.algorithms);
    this.compiler.sync(
      layers,
      this.recipeValue.groups,
      this.wireframeValue,
      this.recipeValue.synthesis,
      this.coordinateSpaceOverride ?? this.recipeValue.coordinateSpace
    );
    applyPhysicalSettings(this.compiler.material, this.recipeValue.physical);
  }
}
