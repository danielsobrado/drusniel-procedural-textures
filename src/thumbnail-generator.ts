import * as THREE from 'three';
import { DEFAULT_PHYSICAL, DEFAULT_SYNTHESIS, EXPORT_CONFIG } from './app/constants';
import { TERRAIN_CONFIG } from './config/terrainConfig';
import { TILE_CONFIG } from './config/tileConfig';
import { PresetThumbnailRenderer } from './export/PresetThumbnailRenderer';
import { makeTextureSeamless } from './export/SeamlessTexture';
import { TextureBaker } from './export/TextureBaker';
import { MaterialCompiler } from './materials/MaterialCompiler';
import { MATERIAL_PRESETS } from './materials/presets';
import { canvasToPngDataUrl } from './utils/canvas';

interface ThumbnailGeneratorApi {
  presetIds: readonly string[];
  render: (id: string) => Promise<string>;
  renderTerrain: (id: string) => Promise<string>;
  dispose: () => void;
}

type GeneratorWindow = Window & typeof globalThis & {
  __PTL_THUMBNAIL_GENERATOR__?: ThumbnailGeneratorApi;
};

const canvas = document.querySelector<HTMLCanvasElement>('#thumbnail-canvas');
if (canvas === null) throw new Error('Thumbnail generator canvas was not found.');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(1);
renderer.setSize(EXPORT_CONFIG.thumbnailSize, EXPORT_CONFIG.thumbnailSize, false);

const thumbnailRenderer = new PresetThumbnailRenderer(renderer, DEFAULT_PHYSICAL);
const terrainCompiler = new MaterialCompiler();
terrainCompiler.setTextureSupportRendererProvider(async () => renderer);
const terrainBaker = new TextureBaker(renderer, terrainCompiler);
const presetsById = new Map(MATERIAL_PRESETS.map((preset) => [preset.id, preset]));
let disposed = false;

const api: ThumbnailGeneratorApi = {
  presetIds: MATERIAL_PRESETS.map((preset) => preset.id),
  async render(id) {
    if (disposed) throw new Error('Thumbnail generator is disposed.');
    const preset = presetsById.get(id);
    if (preset === undefined) throw new Error(`Unknown material preset: ${id}`);
    return thumbnailRenderer.renderAsync(preset);
  },
  async renderTerrain(id) {
    if (disposed) throw new Error('Thumbnail generator is disposed.');
    const preset = presetsById.get(id);
    if (preset === undefined) throw new Error(`Unknown material preset: ${id}`);
    const physical = { ...DEFAULT_PHYSICAL, ...(preset.physical ?? {}) };
    const synthesis = { ...DEFAULT_SYNTHESIS, ...(preset.synthesis ?? {}) };
    terrainCompiler.sync(preset.layers, preset.groups ?? [], false, synthesis);
    terrainCompiler.applyPhysical(physical);
    await terrainCompiler.ensureSimulationReady();

    const geometry = new THREE.PlaneGeometry(TILE_CONFIG.worldSize, TILE_CONFIG.worldSize, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    mesh.name = 'Cached terrain preset sample';
    try {
      const albedo = await terrainBaker.bakeAlbedo(
        mesh,
        physical,
        TERRAIN_CONFIG.materials.presetBakeResolution
      );
      await makeTextureSeamless(albedo, TILE_CONFIG.blendFraction);
      return await canvasToPngDataUrl(albedo.canvas);
    } finally {
      geometry.dispose();
    }
  },
  dispose() {
    if (disposed) return;
    disposed = true;
    thumbnailRenderer.dispose();
    terrainCompiler.dispose();
    renderer.dispose();
  }
};

(window as GeneratorWindow).__PTL_THUMBNAIL_GENERATOR__ = api;
window.addEventListener('beforeunload', () => api.dispose(), { once: true });
document.body.dataset.ready = 'true';
