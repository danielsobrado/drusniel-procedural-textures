import * as THREE from 'three';
import { DEFAULT_PHYSICAL, EXPORT_CONFIG } from './app/constants';
import { PresetThumbnailRenderer } from './export/PresetThumbnailRenderer';
import { MATERIAL_PRESETS } from './materials/presets';

interface ThumbnailGeneratorApi {
  presetIds: readonly string[];
  render: (id: string) => Promise<string>;
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
  dispose() {
    if (disposed) return;
    disposed = true;
    thumbnailRenderer.dispose();
    renderer.dispose();
  }
};

(window as GeneratorWindow).__PTL_THUMBNAIL_GENERATOR__ = api;
window.addEventListener('beforeunload', () => api.dispose(), { once: true });
document.body.dataset.ready = 'true';
