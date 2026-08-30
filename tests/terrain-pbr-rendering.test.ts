import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTerrainMaterialMasks } from '../src/tile/TerrainMaterialMasks';
import type { TerrainFields, TerrainPaintMask } from '../src/tile/TerrainTypes';

const readSource = (relativePath: string): string => readFileSync(
  new URL(relativePath, import.meta.url),
  'utf8'
);

const GENERATOR_SOURCE = readSource('../src/thumbnail-generator.ts');
const LIBRARY_SOURCE = readSource('../src/tile/TerrainPresetTextureLibrary.ts');
const PREVIEW_SOURCE = readSource('../src/tile/TerrainMeshPreview.ts');
const PANEL_SOURCE = readSource('../src/ui/TerrainTileLabPanel.ts');
const TILE_PREVIEW_SOURCE = readSource('../src/ui/TilePreviewPanel.ts');

describe('terrain PBR rendering contract', () => {
  it('starts the player at eye level instead of inheriting the orbit pitch', () => {
    const source = readSource('../src/tile/TerrainPlayerController.ts');

    expect(source).toContain('this.yaw = Math.atan2(-this.direction.x, -this.direction.z)');
    expect(source).toContain('this.pitch = 0');
    expect(source).not.toContain('this.pitch = Math.asin');
  });

  it('keeps automatic classification opaque while preserving soft paint weight', () => {
    const fields: TerrainFields = {
      resolution: 2,
      height: new Float32Array(4),
      slope: new Float32Array(4),
      flow: new Float32Array(4),
      river: new Float32Array(4),
      wetness: new Float32Array(4),
      material: new Uint8Array([0, 1, 2, 3]),
      backend: 'cpu'
    };
    const paint: TerrainPaintMask = {
      material: new Uint8Array([255, 4, 5, 0]),
      weight: new Float32Array([0, 0.25, 0.75, 1])
    };
    const masks = buildTerrainMaterialMasks(fields, paint);

    expect(masks.base[0]).toEqual(new Uint8Array([255, 0, 0, 0]));
    expect(masks.base[3]).toEqual(new Uint8Array([0, 0, 0, 255]));
    expect(masks.override[4]?.[1]).toBe(64);
    expect(masks.override[5]?.[2]).toBe(191);
    expect(masks.override[0]?.[3]).toBe(255);
  });

  it('caches complete seamless PBR preset sets instead of albedo alone', () => {
    expect(GENERATOR_SOURCE).toContain('terrainBaker.bake(');
    expect(GENERATOR_SOURCE).toContain('makeTextureSetSeamless');
    expect(GENERATOR_SOURCE).toContain('TERRAIN_PBR_CHANNELS');
    expect(GENERATOR_SOURCE).not.toContain('terrainBaker.bakeAlbedo(');
    expect(LIBRARY_SOURCE).toContain('splitTerrainPbrAtlas');
  });

  it('renders direct repeated PBR textures selected by terrain masks', () => {
    expect(PREVIEW_SOURCE).toContain('THREE.MeshPhysicalMaterial');
    expect(PREVIEW_SOURCE).toContain('roughnessMap');
    expect(PREVIEW_SOURCE).toContain('normalMap');
    expect(PREVIEW_SOURCE).toContain('clearcoatMap');
    expect(PREVIEW_SOURCE).toContain('metalnessMap');
    expect(PREVIEW_SOURCE).toContain('aoMap');
    expect(PREVIEW_SOURCE).toContain('texture.repeat.set(repeat, repeat)');
    expect(PREVIEW_SOURCE).not.toContain('roughness: 0.88');
  });

  it('does not flatten the 3D terrain material into a low-resolution color canvas', () => {
    const rebuildStart = PANEL_SOURCE.indexOf('private rebuildSurface');
    const rebuildEnd = PANEL_SOURCE.indexOf('private async importTexture', rebuildStart);
    const rebuildMethod = PANEL_SOURCE.slice(rebuildStart, rebuildEnd);
    expect(rebuildMethod).not.toContain('createMaterialCanvas');
    expect(rebuildMethod).toContain('this.painter.mask');
    expect(rebuildMethod).toContain('this.settings.materialRepeat');
  });

  it('passes every current-material bake channel into Tile Lab', () => {
    expect(TILE_PREVIEW_SOURCE).toContain('panel.setCurrentMaterialTextures(this.currentMaterialTextures)');
    expect(TILE_PREVIEW_SOURCE).not.toContain('textures.albedo.canvas');
  });

  it('includes sparse game-scale scene samples that reuse physical materials', () => {
    expect(PREVIEW_SOURCE).toContain('new TerrainGameProps(');
    expect(PANEL_SOURCE).toContain('Rocks, plants & houses');
    expect(PANEL_SOURCE).toContain('this.meshPreview.setGamePropsVisible(input.checked)');
  });
});
