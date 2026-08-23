import { DEFAULT_PHYSICAL, DEFAULT_SYNTHESIS } from '../app/constants';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { TILE_CONFIG } from '../config/tileConfig';
import { makeTextureSetSeamless } from '../export/SeamlessTexture';
import { TileMaterialBaker } from '../export/TileMaterialBaker';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset } from '../materials/types';
import type { TerrainTextureSource } from './TerrainTypes';

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
  private readonly cache = new Map<string, TerrainTextureSource>();
  private readonly pending = new Map<string, Promise<TerrainTextureSource>>();

  public async load(presetId: string): Promise<TerrainTextureSource> {
    const cached = this.cache.get(presetId);
    if (cached !== undefined) return cached;

    const pending = this.pending.get(presetId);
    if (pending !== undefined) return pending;

    const request = this.bake(findPreset(presetId));
    this.pending.set(presetId, request);
    try {
      const texture = await request;
      this.cache.set(presetId, texture);
      return texture;
    } finally {
      this.pending.delete(presetId);
    }
  }

  public clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  private async bake(preset: Readonly<MaterialPreset>): Promise<TerrainTextureSource> {
    const compiler = new MaterialCompiler();
    const physical = { ...DEFAULT_PHYSICAL, ...(preset.physical ?? {}) };
    const synthesis = { ...DEFAULT_SYNTHESIS, ...(preset.synthesis ?? {}) };
    compiler.sync(preset.layers, preset.groups ?? [], false, synthesis);
    compiler.applyPhysical(physical);

    try {
      await compiler.ensureSimulationReady();
      const baker = new TileMaterialBaker(compiler);
      const textures = await baker.bake(
        physical,
        TERRAIN_CONFIG.materials.presetBakeResolution,
        TILE_CONFIG.worldSize
      );
      const seamless = await makeTextureSetSeamless(textures, {
        blendFraction: TILE_CONFIG.blendFraction,
        worldSize: TILE_CONFIG.worldSize,
        displacementExtent: compiler.displacementExtent
      });
      return textureFromCanvas(seamless.albedo.canvas);
    } finally {
      compiler.dispose();
    }
  }
}
