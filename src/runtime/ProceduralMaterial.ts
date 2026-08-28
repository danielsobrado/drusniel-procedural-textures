import * as THREE from 'three';
import {
  normalizeResolvedTextureField,
  type ResolvedTextureField
} from '../core/texture/ResolvedTextureField';
import { requiredTextureFieldIds } from '../core/material/MaterialFieldDependencies';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { MaterialComputeEngine } from '../engine/MaterialComputeEngine';
import {
  buildMaterialSimulationAtlas,
  materialRequiresSimulation
} from '../engine/SimulationAtlas';
import { SurfaceMaterialCompiler } from '../materials/SurfaceMaterialCompiler';
import { WebGpuMaterialCompiler } from '../materials/WebGpuMaterialCompiler';
import type { MaterialLayer } from '../core/material/RuntimeMaterial';
import { parseMaterialRecipe, reseedMaterialRecipe, type MaterialRecipe } from './MaterialRecipe';
import {
  GeneratedTextureResolver,
  type GeneratedTextureResolverOptions
} from './GeneratedTextureResolver';
import type { TextureResolver } from './TextureResolver';

export type ProceduralMaterialBackend = 'webgpu' | 'webgl';
export type TextureFieldSource = 'auto' | 'generated' | 'external';

export interface ProceduralMaterialOptions {
  wireframe?: boolean;
  coordinateSpace?: MaterialCoordinateSpace;
  /** WebGPU/TSL is preferred. Use `webgl` only with a classic WebGLRenderer. */
  backend?: ProceduralMaterialBackend;
  /** Resolves external texture-field dependencies declared by hybrid Material Recipes. */
  textureResolver?: TextureResolver;
  /**
   * `auto` uses a supplied resolver or falls back to generated fields. `external` requires
   * a resolver for texture-bearing recipes. `generated` forces the code-only fallback.
   */
  textureFieldSource?: TextureFieldSource;
  /** Quality/memory controls for code-only generated fields. */
  generatedTextureFields?: GeneratedTextureResolverOptions;
}

type RuntimeMaterialCompiler = SurfaceMaterialCompiler | WebGpuMaterialCompiler;

const UINT32_RANGE = 0x1_0000_0000;

function normalizeBackend(value: unknown): ProceduralMaterialBackend {
  if (value === undefined) return 'webgpu';
  if (value !== 'webgpu' && value !== 'webgl') {
    throw new Error(`Unsupported procedural material backend: ${String(value)}.`);
  }
  return value;
}

function normalizeCoordinateSpaceOverride(value: unknown): MaterialCoordinateSpace | null {
  if (value === undefined || value === null) return null;
  if (value !== 'object' && value !== 'world') {
    throw new Error(`Unsupported material coordinate space: ${String(value)}.`);
  }
  return value;
}

function normalizeWireframe(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error('Wireframe must be a boolean.');
  return value;
}

function normalizeTextureResolver(value: unknown): TextureResolver | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || typeof (value as Partial<TextureResolver>).resolve !== 'function') {
    throw new Error('Texture resolver must provide a resolve(id) function.');
  }
  const release = (value as Partial<TextureResolver>).release;
  if (release !== undefined && typeof release !== 'function') {
    throw new Error('Texture resolver release must be a function when provided.');
  }
  return value as TextureResolver;
}

function normalizeTextureFieldSource(value: unknown): TextureFieldSource {
  if (value === undefined) return 'auto';
  if (value !== 'auto' && value !== 'generated' && value !== 'external') {
    throw new Error(`Unsupported texture-field source: ${String(value)}.`);
  }
  return value;
}

function selectTextureResolver(options: Readonly<ProceduralMaterialOptions>): {
  resolver: TextureResolver | null;
  source: Exclude<TextureFieldSource, 'auto'>;
} {
  const source = normalizeTextureFieldSource(options.textureFieldSource);
  const external = normalizeTextureResolver(options.textureResolver);
  if (source === 'generated' && external !== null) {
    throw new Error('Generated texture-field source cannot be combined with textureResolver; use "auto" instead.');
  }
  if (source === 'external') {
    return { resolver: external, source: 'external' };
  }
  if (source === 'auto' && external !== null) {
    return {
      resolver: external,
      source: external instanceof GeneratedTextureResolver ? 'generated' : 'external'
    };
  }
  return {
    resolver: new GeneratedTextureResolver(options.generatedTextureFields),
    source: 'generated'
  };
}

export function runtimeSeedOffset(seed: number): number {
  if (seed === 0) return 0;
  return (Math.imul(seed, 0x9e37_79b1) >>> 0) / UINT32_RANGE * 100;
}

export function runtimeVariantLayers(
  layers: readonly MaterialLayer[],
  recipeSeed: number
): MaterialLayer[] {
  const offset = runtimeSeedOffset(recipeSeed);
  if (offset === 0) return layers.map((layer) => ({ ...layer }));
  return layers.map((layer) => ({
    ...layer,
    seed: (layer.seed + offset) % 100
  }));
}

/**
 * Lightweight Three.js runtime for a portable PTL Material Recipe.
 * Call `prepare()` before first render to hydrate simulations and required texture fields.
 */
export class ProceduralMaterial {
  private readonly compiler: RuntimeMaterialCompiler;
  private readonly compute = new MaterialComputeEngine();
  private readonly textureResolver: TextureResolver | null;
  private readonly resolvedTextures = new Map<string, ResolvedTextureField>();
  private recipeValue: MaterialRecipe;
  private wireframeValue: boolean;
  private coordinateSpaceOverride: MaterialCoordinateSpace | null;
  private preparationSequence = 0;
  private disposed = false;
  public readonly backend: ProceduralMaterialBackend;
  public readonly textureFieldSource: Exclude<TextureFieldSource, 'auto'>;

  public constructor(recipe: unknown, options: Readonly<ProceduralMaterialOptions> = {}) {
    const backend = normalizeBackend(options.backend);
    const textureFields = selectTextureResolver(options);
    const recipeValue = parseMaterialRecipe(recipe);
    const wireframe = normalizeWireframe(options.wireframe);
    const coordinateSpaceOverride = normalizeCoordinateSpaceOverride(options.coordinateSpace);

    this.backend = backend;
    this.textureFieldSource = textureFields.source;
    this.compiler = backend === 'webgpu'
      ? new WebGpuMaterialCompiler()
      : new SurfaceMaterialCompiler();
    this.textureResolver = textureFields.resolver;
    this.recipeValue = recipeValue;
    this.wireframeValue = wireframe;
    this.coordinateSpaceOverride = coordinateSpaceOverride;
    this.sync();
    this.compiler.material.name = 'PTL Procedural Material';
    if (this.compiler instanceof SurfaceMaterialCompiler) {
      this.compiler.depthMaterial.name = 'PTL Procedural Depth';
      this.compiler.distanceMaterial.name = 'PTL Procedural Distance';
    }
  }

  public get material(): THREE.Material {
    return this.compiler.material;
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
    this.assertAvailable();
    const sequence = ++this.preparationSequence;
    const layers = runtimeVariantLayers(this.recipeValue.layers, this.recipeValue.seed);
    await this.prepareTextureFields(layers, sequence);
    if (this.disposed || sequence !== this.preparationSequence) return;

    if (!materialRequiresSimulation(layers)) {
      this.compiler.setSimulationAtlas(null);
      return;
    }

    await this.compute.initialize();
    // Disposing while the adapter request is in flight is routine for a host that unmounts
    // mid-preparation. Without this check the compute engine would reject the caller's
    // prepare() instead of it settling quietly like every other cancellation path here.
    if (this.disposed || sequence !== this.preparationSequence) return;
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
    this.assertAvailable();
    this.recipeValue = parseMaterialRecipe(recipe);
    this.invalidatePreparation();
    this.releaseResolvedTextures();
    this.sync();
  }

  public setSeed(seed: number): void {
    this.assertAvailable();
    this.recipeValue = reseedMaterialRecipe(this.recipeValue, seed);
    this.invalidatePreparation();
    this.sync();
  }

  public setCoordinateSpace(coordinateSpace: MaterialCoordinateSpace | null): void {
    this.assertAvailable();
    this.coordinateSpaceOverride = normalizeCoordinateSpaceOverride(coordinateSpace);
    this.sync();
  }

  public setWireframe(enabled: boolean): void {
    this.assertAvailable();
    this.wireframeValue = normalizeWireframe(enabled);
    this.sync();
  }

  public applyTo(mesh: THREE.Mesh): void {
    this.assertAvailable();
    mesh.material = this.material;
    mesh.customDepthMaterial = this.compiler instanceof SurfaceMaterialCompiler
      ? this.compiler.depthMaterial
      : undefined;
    mesh.customDistanceMaterial = this.compiler instanceof SurfaceMaterialCompiler
      ? this.compiler.distanceMaterial
      : undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparationSequence += 1;
    try {
      this.releaseResolvedTextures();
    } finally {
      this.compute.dispose();
      this.compiler.dispose();
    }
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Procedural material has been disposed.');
  }

  private invalidatePreparation(): void {
    this.preparationSequence += 1;
    this.compiler.setSimulationAtlas(null);
  }

  private async prepareTextureFields(layers: readonly MaterialLayer[], sequence: number): Promise<void> {
    const ids = requiredTextureFieldIds(layers);
    if (ids.length === 0) {
      this.releaseResolvedTextures();
      return;
    }
    const resolver = this.textureResolver;
    if (resolver === null) {
      throw new Error(
        `Material Recipe requires externally resolved texture fields (${ids.join(', ')}). ` +
        'Provide ProceduralMaterialOptions.textureResolver or use textureFieldSource "generated".'
      );
    }

    const attempts = await Promise.allSettled(ids.map(async (id) => {
      const existing = this.resolvedTextures.get(id);
      if (existing !== undefined) return [id, existing, false] as const;
      const resource = await resolver.resolve(id);
      const resolved = normalizeResolvedTextureField(resource);
      if (!(resolved.texture instanceof THREE.Texture)) {
        throw new Error(`Texture resolver returned an invalid texture for ${id}.`);
      }
      return [id, resolved, true] as const;
    }));
    const acquired = new Map<string, ResolvedTextureField>();
    const resolved: Array<readonly [string, ResolvedTextureField]> = [];
    let failed = false;
    let failure: unknown;

    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        if (!failed) failure = attempt.reason;
        failed = true;
        continue;
      }
      const [id, binding, wasAcquired] = attempt.value;
      resolved.push([id, binding]);
      if (wasAcquired) acquired.set(id, binding);
    }

    if (failed) {
      for (const [id, binding] of acquired) resolver.release?.(id, binding.texture);
      throw failure;
    }
    if (this.disposed || sequence !== this.preparationSequence) {
      for (const [id, binding] of acquired) resolver.release?.(id, binding.texture);
      return;
    }

    const next = new Map(resolved);
    for (const [id, binding] of this.resolvedTextures) {
      if (next.get(id) !== binding) resolver.release?.(id, binding.texture);
    }
    this.resolvedTextures.clear();
    for (const [id, texture] of next) this.resolvedTextures.set(id, texture);
    this.compiler.setTextureFields(this.resolvedTextures);
  }

  private releaseResolvedTextures(): void {
    if (this.textureResolver !== null) {
      for (const [id, binding] of this.resolvedTextures) this.textureResolver.release?.(id, binding.texture);
    }
    this.resolvedTextures.clear();
    this.compiler.setTextureFields(this.resolvedTextures);
  }

  private sync(): void {
    const layers = runtimeVariantLayers(this.recipeValue.layers, this.recipeValue.seed);
    this.compiler.setAlgorithmSettings(this.recipeValue.algorithms);
    this.compiler.setTextureFields(this.resolvedTextures);
    this.compiler.sync(
      layers,
      this.recipeValue.groups,
      this.wireframeValue,
      this.recipeValue.synthesis,
      this.coordinateSpaceOverride ?? this.recipeValue.coordinateSpace
    );
    this.compiler.setPhysical(this.recipeValue.physical);
  }
}
