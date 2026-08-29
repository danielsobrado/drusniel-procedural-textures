import { presetTerrainTextureUrl } from '../assets/PresetAssets';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset } from '../materials/types';
import type { TerrainTextureSource } from './TerrainTypes';

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

interface PendingLoadState {
  waiters: (() => boolean)[];
  reporters: TerrainPresetBakeProgress[];
}

interface PendingLoad extends PendingLoadState {
  request: Promise<TerrainTextureSource>;
}

function findPreset(id: string): MaterialPreset {
  const preset = MATERIAL_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new Error(`Unknown material preset: ${id}.`);
  return preset;
}

function textureFromCanvas(canvas: HTMLCanvasElement): TerrainTextureSource {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Could not read the cached terrain preset texture.');
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: context.getImageData(0, 0, canvas.width, canvas.height).data.slice()
  };
}

async function loadPresetTerrainTexture(presetId: string, resolution: number): Promise<HTMLCanvasElement> {
  const response = await fetch(presetTerrainTextureUrl(presetId));
  if (!response.ok) {
    throw new Error(`Could not load the cached terrain texture for ${presetId} (${response.status}).`);
  }

  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (bitmap.width !== resolution || bitmap.height !== resolution) {
      throw new Error(
        `Cached terrain texture ${presetId} must be ${resolution}×${resolution}; ` +
        `received ${bitmap.width}×${bitmap.height}.`
      );
    }
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('Could not prepare the cached terrain texture.');
    context.drawImage(bitmap, 0, 0);
    return canvas;
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

  /** Cancels publication by active panel instances while retaining the immutable pixel cache. */
  public clear(): void {
    this.generation += 1;
    this.pending.clear();
  }

  private async loadPreset(
    preset: Readonly<MaterialPreset>,
    state: PendingLoadState
  ): Promise<TerrainTextureSource> {
    const isWanted = (): boolean => state.waiters.some((isCurrent) => isCurrent());
    if (!isWanted()) throw new TerrainPresetBakeCancelled(preset.id);

    const resolution = TERRAIN_CONFIG.materials.presetBakeResolution;
    report(state, 'Loading cached preview', 0.15);
    const canvas = await loadPresetTerrainTexture(preset.id, resolution);

    if (!isWanted()) throw new TerrainPresetBakeCancelled(preset.id);
    report(state, 'Ready', 1);
    return textureFromCanvas(canvas);
  }
}

function report(state: PendingLoadState, phase: string, fraction: number): void {
  for (const reporter of state.reporters) reporter(phase, fraction);
}
