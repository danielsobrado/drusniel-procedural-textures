import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { TerrainComputeEngine } from './TerrainComputeEngine';
import { buildTerrainFields } from './TerrainHydrology';
import type { TerrainFields, TerrainSettings } from './TerrainTypes';

export class TerrainGenerator {
  private readonly compute = new TerrainComputeEngine();

  public async generate(
    settings: Readonly<TerrainSettings>,
    resolution = TERRAIN_CONFIG.resolution
  ): Promise<TerrainFields> {
    const generated = await this.compute.generate(settings, resolution);
    return buildTerrainFields(
      generated.height,
      resolution,
      settings,
      generated.backend
    );
  }
}
