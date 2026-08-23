import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { TerrainComputeEngine } from './TerrainComputeEngine';
import { buildTerrainFieldsChunked, type TerrainFieldProgress } from './TerrainHydrology';
import type { TerrainFields, TerrainSettings } from './TerrainTypes';

export class TerrainGenerator {
  private readonly compute = new TerrainComputeEngine();

  public async generate(
    settings: Readonly<TerrainSettings>,
    resolution = TERRAIN_CONFIG.resolution,
    onProgress?: TerrainFieldProgress
  ): Promise<TerrainFields> {
    const generated = await this.compute.generate(settings, resolution);
    return buildTerrainFieldsChunked(
      generated.height,
      resolution,
      settings,
      generated.backend,
      onProgress
    );
  }
}
