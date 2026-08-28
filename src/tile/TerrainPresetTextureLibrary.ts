import { DEFAULT_PHYSICAL, DEFAULT_SYNTHESIS } from '../app/constants';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { TILE_CONFIG } from '../config/tileConfig';
import { makeTextureSeamless } from '../export/SeamlessTexture';
import { TileMaterialBaker } from '../export/TileMaterialBaker';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset } from '../materials/types';
import type { TerrainTextureSource } from './TerrainTypes';

/** Matches the terrain generator's reporter shape so both wire into the same status line. */
export type TerrainPresetBakeProgress = (phase: string, fraction: number) => void;

export interface TerrainPresetLoadOptions {
  onProgress?: TerrainPresetBakeProgress;
  /**
   * Consulted just before the queued bake starts. A slot that has moved on to another preset
   * reports false, and the bake is dropped instead of occupying the GPU ahead of the one the
   * user is actually waiting for.
   */
  isCurrent?: () => boolean;
}

/** Thrown when every requester lost interest before the queued bake reached the front. */
export class TerrainPresetBakeCancelled extends Error {
  public constructor(presetId: string) {
    super(`Terrain preset bake cancelled: ${presetId}.`);
    this.name = 'TerrainPresetBakeCancelled';
  }
}

/**
 * Baked previews are plain pixel buffers keyed by an immutable preset id, so they stay valid
 * for the life of the page and are shared across panel instances: closing the Tile Lab and
 * reopening it no longer re-bakes. 256² RGBA is 256 KB an entry, so the cache is bounded.
 */
const PRESET_CACHE_LIMIT = 24;
const presetCache = new Map<string, TerrainTextureSource>();

function cacheRead(presetId: string): TerrainTextureSource | undefined {
  const hit = presetCache.get(presetId);
  if (hit === undefined) return undefined;
  presetCache.delete(presetId);
  presetCache.set(presetId, hit);
  return hit;
}

function cacheWrite(presetId: string, texture: TerrainTextureSource): void {
  presetCache.delete(presetId);
  presetCache.set(presetId, texture);
  for (const oldest of presetCache.keys()) {
    if (presetCache.size <= PRESET_CACHE_LIMIT) break;
    presetCache.delete(oldest);
  }
}

interface BakeResources {
  compiler: MaterialCompiler;
  baker: TileMaterialBaker;
}

interface PendingBake {
  request: Promise<TerrainTextureSource>;
  /** One entry per in-flight caller; the bake runs while any of them is still current. */
  waiters: (() => boolean)[];
  reporters: TerrainPresetBakeProgress[];
}

function findPreset(id: string): MaterialPreset {
  const preset = MATERIAL_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new Error(`Unknown material preset: ${id}.`);
  return preset;
}

function textureFromCanvas(canvas: HTMLCanvasElement): TerrainTextureSource {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Could not read the baked terrain preset texture.');
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: context.getImageData(0, 0, canvas.width, canvas.height).data.slice()
  };
}

export class TerrainPresetTextureLibrary {
  private readonly pending = new Map<string, PendingBake>();
  private compiler: MaterialCompiler | null = null;
  private baker: TileMaterialBaker | null = null;
  private bakeQueue: Promise<void> = Promise.resolve();
  private queueDepth = 0;
  /**
   * Bumped by clear(). A bake that was already in flight across a clear() must not publish
   * its result, or it would overwrite the newer request that replaced it.
   */
  private generation = 0;

  public async load(
    presetId: string,
    options: Readonly<TerrainPresetLoadOptions> = {}
  ): Promise<TerrainTextureSource> {
    const cached = cacheRead(presetId);
    if (cached !== undefined) {
      options.onProgress?.('Ready', 1);
      return cached;
    }

    const pending = this.pending.get(presetId);
    if (pending !== undefined) {
      pending.waiters.push(options.isCurrent ?? (() => true));
      if (options.onProgress !== undefined) pending.reporters.push(options.onProgress);
      return pending.request;
    }

    const generation = this.generation;
    const entry: PendingBake = {
      request: Promise.resolve() as unknown as Promise<TerrainTextureSource>,
      waiters: [options.isCurrent ?? (() => true)],
      reporters: options.onProgress === undefined ? [] : [options.onProgress]
    };
    entry.request = this.enqueueBake(findPreset(presetId), entry);
    this.pending.set(presetId, entry);
    try {
      const texture = await entry.request;
      if (generation === this.generation && this.pending.get(presetId) === entry) {
        cacheWrite(presetId, texture);
      }
      return texture;
    } finally {
      if (this.pending.get(presetId) === entry) this.pending.delete(presetId);
    }
  }

  /** Creates the bake context ahead of the first user interaction. Safe to call repeatedly. */
  public warm(): void {
    try {
      this.resources();
    } catch {
      // A machine without WebGL2 surfaces the failure on the first real bake instead.
    }
  }

  /** Releases the GPU context. The pixel cache is deliberately kept; see presetCache. */
  public clear(): void {
    this.generation += 1;
    this.pending.clear();
    const queue = this.bakeQueue;
    void queue.then(() => this.releaseResources());
  }

  private enqueueBake(
    preset: Readonly<MaterialPreset>,
    entry: PendingBake
  ): Promise<TerrainTextureSource> {
    // Bakes are serialized because they share one WebGL context. Anything still waiting when
    // its slot has moved on is dropped here, so a burst of preset changes costs one bake
    // rather than one per click.
    this.queueDepth += 1;
    const ahead = this.queueDepth - 1;
    if (ahead > 0) {
      report(entry, `Queued behind ${ahead} bake${ahead === 1 ? '' : 's'}`, 0);
    }

    const request = this.bakeQueue.then(async () => {
      if (!entry.waiters.some((isCurrent) => isCurrent())) {
        throw new TerrainPresetBakeCancelled(preset.id);
      }
      return await this.bake(preset, entry);
    });

    this.bakeQueue = request.then(
      () => { this.queueDepth = Math.max(0, this.queueDepth - 1); },
      () => { this.queueDepth = Math.max(0, this.queueDepth - 1); }
    );
    return request;
  }

  private resources(): BakeResources {
    if (this.compiler !== null && this.baker !== null) {
      return { compiler: this.compiler, baker: this.baker };
    }

    const compiler = new MaterialCompiler();
    const baker = new TileMaterialBaker(compiler);
    // Presets whose layers reference KTX2 texture fields cannot compile until the resolver has
    // a renderer to detect transcoder support against. The provider has to be installed before
    // the first sync() kicks off texture-field preparation.
    compiler.setTextureSupportRendererProvider(async () => baker.acquireRenderer());
    this.compiler = compiler;
    this.baker = baker;
    return { compiler, baker };
  }

  private releaseResources(): void {
    const compiler = this.compiler;
    const baker = this.baker;
    this.compiler = null;
    this.baker = null;
    baker?.dispose();
    compiler?.dispose();
  }

  private async bake(
    preset: Readonly<MaterialPreset>,
    entry: PendingBake
  ): Promise<TerrainTextureSource> {
    const resolution = TERRAIN_CONFIG.materials.presetBakeResolution;
    report(entry, 'Compiling material', 0.05);
    const { compiler, baker } = this.resources();
    const physical = { ...DEFAULT_PHYSICAL, ...(preset.physical ?? {}) };
    const synthesis = { ...DEFAULT_SYNTHESIS, ...(preset.synthesis ?? {}) };
    compiler.sync(preset.layers, preset.groups ?? [], false, synthesis);
    compiler.applyPhysical(physical);

    // The first bake of a session pays for the KTX2 transcoder and the shader compile in here,
    // which is why this phase can dominate before the cache warms up.
    report(entry, 'Preparing texture fields', 0.15);
    await compiler.ensureSimulationReady();

    report(entry, `Rendering ${resolution}²`, 0.45);
    const albedo = await baker.bakeAlbedo(physical, resolution, TILE_CONFIG.worldSize);

    report(entry, 'Blending seams', 0.85);
    await makeTextureSeamless(albedo, TILE_CONFIG.blendFraction);

    report(entry, 'Ready', 1);
    return textureFromCanvas(albedo.canvas);
  }
}

function report(entry: PendingBake, phase: string, fraction: number): void {
  for (const reporter of entry.reporters) reporter(phase, fraction);
}
