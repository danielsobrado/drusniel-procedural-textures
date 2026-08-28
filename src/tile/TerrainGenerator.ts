import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { TerrainComputeEngine } from './TerrainComputeEngine';
import { buildTerrainFieldsChunked, type TerrainFieldProgress } from './TerrainHydrology';
import type { TerrainFields, TerrainSettings } from './TerrainTypes';

export class TerrainGenerator {
  private readonly compute = new TerrainComputeEngine();

  public async generate(
    settings: Readonly<TerrainSettings>,
    resolution = TERRAIN_CONFIG.resolution,
    onProgress?: TerrainFieldProgress,
    signal?: AbortSignal
  ): Promise<TerrainFields> {
    // Editor controls mutate their settings object in place. Keep every async phase on the
    // same job snapshot even when the user starts another generation while this one yields.
    const snapshot = { ...settings };
    signal?.throwIfAborted();
    const generated = await this.compute.generate(snapshot, resolution, signal);
    signal?.throwIfAborted();
    return buildTerrainFieldsChunked(
      generated.height,
      resolution,
      snapshot,
      generated.backend,
      onProgress,
      signal
    );
  }
}
