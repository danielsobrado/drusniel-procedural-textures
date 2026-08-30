import { presetTerrainTextureUrl } from '../assets/PresetAssets';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset } from '../materials/types';
import {
  splitTerrainPbrAtlas,
  TERRAIN_PBR_ATLAS_COLUMNS,
  TERRAIN_PBR_ATLAS_ROWS
} from './TerrainPbrAtlas';
import type { TerrainPbrTextureSet } from './TerrainTypes';

/** Matches the terrain generator's reporter shape so both wire into the same status line. */
export type TerrainPresetBakeProgress = (phase: string, fraction: number) => void;

export interface TerrainPresetLoadOptions {
  onProgress?: TerrainPresetBakeProgress;
  /** Consulted before and after the asset load so obsolete UI requests can be discarded. */
  isCurrent?: () => boolean;
}

/** Thrown when every requester lost interest before a preset texture can be published. */
export class TerrainPresetBakeCancelled extends Error {
  public constructor(presetId: string) {
    super(`Terrain preset load cancelled: ${presetId}.`);
    this.name = 'TerrainPresetBakeCancelled';
  }
}

/**
 * Preset previews are immutable pixel buffers keyed by preset id. They are shared across panel
 * instances and retained in a bounded LRU cache for the life of the page.
 */
/**
 * Each entry retains nine 256² RGBA buffers, ~2.4 MB. Twenty-four rarely filled while the
 * only way in was clicking a preset, but hover-dwell prefetch fills it in seconds, so the
 * ceiling is set where the retained total stays modest (~28 MB).
 */
const PRESET_CACHE_LIMIT = 12;
const presetCache = new Map<string, TerrainPbrTextureSet>();

function cacheRead(presetId: string): TerrainPbrTextureSet | undefined {
  const hit = presetCache.get(presetId);
  if (hit === undefined) return undefined;
  presetCache.delete(presetId);
  presetCache.set(presetId, hit);
  return hit;
}

function cacheWrite(presetId: string, texture: TerrainPbrTextureSet): void {
  presetCache.delete(presetId);
  presetCache.set(presetId, texture);
  for (const oldest of presetCache.keys()) {
    if (presetCache.size <= PRESET_CACHE_LIMIT) break;
    presetCache.delete(oldest);
  }
}

interface PendingLoadState {
  waiters: (() => boolean)[];
  reporters: TerrainPresetBakeProgress[];
}

interface PendingLoad extends PendingLoadState {
  request: Promise<TerrainPbrTextureSet>;
}

function findPreset(id: string): MaterialPreset {
  const preset = MATERIAL_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new Error(`Unknown material preset: ${id}.`);
  return preset;
}

async function loadPresetTerrainTexture(presetId: string, resolution: number): Promise<TerrainPbrTextureSet> {
  const response = await fetch(presetTerrainTextureUrl(presetId));
  if (!response.ok) {
    throw new Error(`Could not load the cached terrain texture for ${presetId} (${response.status}).`);
  }

  const bitmap = await createImageBitmap(await response.blob());
  try {
    const expectedWidth = resolution * TERRAIN_PBR_ATLAS_COLUMNS;
    const expectedHeight = resolution * TERRAIN_PBR_ATLAS_ROWS;
    if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
      throw new Error(
        `Cached terrain PBR atlas ${presetId} must be ${expectedWidth}×${expectedHeight}; ` +
        `received ${bitmap.width}×${bitmap.height}.`
      );
    }
    return splitTerrainPbrAtlas(bitmap, resolution);
  } finally {
    bitmap.close();
  }
}

export class TerrainPresetTextureLibrary {
  private readonly pending = new Map<string, PendingLoad>();
  private generation = 0;

  public async load(
    presetId: string,
    options: Readonly<TerrainPresetLoadOptions> = {}
  ): Promise<TerrainPbrTextureSet> {
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

    const preset = findPreset(presetId);
    const generation = this.generation;
    const state: PendingLoadState = {
      waiters: [options.isCurrent ?? (() => true)],
      reporters: options.onProgress === undefined ? [] : [options.onProgress]
    };
    const entry: PendingLoad = {
      ...state,
      request: Promise.resolve().then(() => this.loadPreset(preset, state))
    };
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

  /**
   * Warms the shared cache for a preset the pointer is merely hovering, so the click that
   * usually follows resolves from cache instead of a ~500 KB fetch.
   *
   * Deliberately registers no `isCurrent`: a cancellable waiter that goes stale while a real
   * `load()` is sharing the same in-flight request would reject that load too. A speculative
   * fetch that completes unused is the cheaper failure.
   */
  public async prefetch(presetId: string): Promise<void> {
    try {
      await this.load(presetId);
    } catch (error) {
      if (error instanceof TerrainPresetBakeCancelled) return;
      // Speculative warm-up must never surface as a user-visible failure. The real load on
      // click reports through its own progress and error path.
      console.debug(`Terrain preset prefetch skipped for ${presetId}.`, error);
    }
  }

  /** Cancels publication by active panel instances while retaining the immutable pixel cache. */
  public clear(): void {
    this.generation += 1;
    this.pending.clear();
  }

  private async loadPreset(
    preset: Readonly<MaterialPreset>,
    state: PendingLoadState
  ): Promise<TerrainPbrTextureSet> {
    const isWanted = (): boolean => state.waiters.some((isCurrent) => isCurrent());
    if (!isWanted()) throw new TerrainPresetBakeCancelled(preset.id);

    const resolution = TERRAIN_CONFIG.materials.presetBakeResolution;
    report(state, 'Loading cached preview', 0.15);
    const textures = await loadPresetTerrainTexture(preset.id, resolution);

    if (!isWanted()) throw new TerrainPresetBakeCancelled(preset.id);
    report(state, 'Ready', 1);
    return textures;
  }
}

function report(state: PendingLoadState, phase: string, fraction: number): void {
  for (const reporter of state.reporters) reporter(phase, fraction);
}
