import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { TERRAIN_MATERIALS, type TerrainFields, type TerrainPaintMask, type TerrainTextureSource, type TerrainViewMode } from './TerrainTypes';

const NO_MATERIAL = 255;
const WATER: readonly [number, number, number] = [35, 82, 101];

function byte(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function fract(value: number): number { return value - Math.floor(value); }
function noise(x: number, y: number): number { return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453); }
function fieldIndex(u: number, v: number, size: number): number {
  return Math.min(size - 1, Math.floor(fract(v) * size)) * size + Math.min(size - 1, Math.floor(fract(u) * size));
}

export function terrainTextureFromCanvas(source: HTMLCanvasElement): TerrainTextureSource | null {
  const maxDimension = TERRAIN_CONFIG.imports.maxDimension;
  const sourceWidth = Math.max(1, source.width);
  const sourceHeight = Math.max(1, source.height);
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const copy = document.createElement('canvas');
  copy.width = Math.max(1, Math.round(sourceWidth * scale));
  copy.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = copy.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(source, 0, 0, copy.width, copy.height);
  return { width: copy.width, height: copy.height, pixels: context.getImageData(0, 0, copy.width, copy.height).data.slice() };
}

export class TerrainSurfaceComposer {
  private readonly textures = new Map<number, TerrainTextureSource>();

  public setTexture(materialIndex: number, texture: TerrainTextureSource | null): void {
    if (texture === null) this.textures.delete(materialIndex);
    else this.textures.set(materialIndex, texture);
  }

  public renderPreview(canvas: HTMLCanvasElement, fields: Readonly<TerrainFields>, paint: Readonly<TerrainPaintMask>, view: TerrainViewMode, materialRepeat: number): void {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const requestedRatio = Math.min(window.devicePixelRatio, 2);
    const boundedRatio = Math.sqrt(TERRAIN_CONFIG.preview.maxPixels / Math.max(1, bounds.width * bounds.height));
    const ratio = Math.min(requestedRatio, boundedRatio);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.render(canvas, fields, paint, view, materialRepeat, view === 'repeat' ? 3 : 1);
  }

  public createMaterialCanvas(fields: Readonly<TerrainFields>, paint: Readonly<TerrainPaintMask>, materialRepeat: number, size = 512): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    this.render(canvas, fields, paint, 'material', materialRepeat, 1);
    return canvas;
  }

  private render(canvas: HTMLCanvasElement, fields: Readonly<TerrainFields>, paint: Readonly<TerrainPaintMask>, view: TerrainViewMode, materialRepeat: number, tiles: number): void {
    const context = canvas.getContext('2d');
    if (context === null) return;
    const image = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += 1) {
      const v = ((y + 0.5) / canvas.height) * tiles;
      for (let x = 0; x < canvas.width; x += 1) {
        const u = ((x + 0.5) / canvas.width) * tiles;
        const index = fieldIndex(u, v, fields.resolution);
        const color = this.colorAt(fields, paint, index, u, v, view, materialRepeat);
        const target = (y * canvas.width + x) * 4;
        image.data[target] = color[0]; image.data[target + 1] = color[1]; image.data[target + 2] = color[2]; image.data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    if (tiles <= 1) return;
    context.save();
    context.strokeStyle = 'rgba(235,240,255,.18)';
    context.lineWidth = Math.max(1, Math.min(window.devicePixelRatio, 2));
    for (let tile = 1; tile < tiles; tile += 1) {
      const x = canvas.width * tile / tiles;
      const y = canvas.height * tile / tiles;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
      context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
    }
    context.restore();
  }

  private colorAt(fields: Readonly<TerrainFields>, paint: Readonly<TerrainPaintMask>, index: number, u: number, v: number, view: TerrainViewMode, materialRepeat: number): readonly [number, number, number] {
    if (view === 'height') { const n = byte((fields.height[index] ?? 0) * 255); return [n, n, n]; }
    if (view === 'slope') { const n = fields.slope[index] ?? 0; return [byte(42 + n * 205), byte(48 + n * 116), byte(58 + n * 65)]; }
    if (view === 'flow') { const n = fields.flow[index] ?? 0; return [byte(20 + n * 75), byte(35 + n * 145), byte(50 + n * 200)]; }
    if (view === 'river') { const n = fields.river[index] ?? 0; return [byte(16 + n * 40), byte(28 + n * 110), byte(36 + n * 175)]; }
    if (view === 'wetness') { const n = fields.wetness[index] ?? 0; return [byte(35 + n * 55), byte(45 + n * 105), byte(43 + n * 125)]; }

    const autoIndex = fields.material[index] ?? 0;
    const overrideIndex = paint.material[index] ?? NO_MATERIAL;
    const weight = overrideIndex === NO_MATERIAL ? 0 : paint.weight[index] ?? 0;
    const auto = this.materialColor(autoIndex, u, v, fields, index, materialRepeat);
    const override = overrideIndex === NO_MATERIAL ? auto : this.materialColor(overrideIndex, u, v, fields, index, materialRepeat);
    const river = Math.min(0.92, (fields.river[index] ?? 0) * 0.94);
    const shade = 1 - (fields.slope[index] ?? 0) * 0.18;
    return [
      byte(mix(mix(auto[0], override[0], weight) * shade, WATER[0], river)),
      byte(mix(mix(auto[1], override[1], weight) * shade, WATER[1], river)),
      byte(mix(mix(auto[2], override[2], weight) * shade, WATER[2], river))
    ];
  }

  private materialColor(materialIndex: number, u: number, v: number, fields: Readonly<TerrainFields>, index: number, materialRepeat: number): readonly [number, number, number] {
    const texture = this.textures.get(materialIndex);
    if (texture !== undefined) {
      const tx = Math.floor(fract(u * materialRepeat) * texture.width) % texture.width;
      const ty = Math.floor(fract(v * materialRepeat) * texture.height) % texture.height;
      const source = (ty * texture.width + tx) * 4;
      return [texture.pixels[source] ?? 0, texture.pixels[source + 1] ?? 0, texture.pixels[source + 2] ?? 0];
    }
    const base = (TERRAIN_MATERIALS[materialIndex] ?? TERRAIN_MATERIALS[0]!).color;
    const grain = (noise(index % fields.resolution, Math.floor(index / fields.resolution)) - 0.5) * 18;
    const wet = (fields.wetness[index] ?? 0) * (materialIndex === 2 ? 20 : 5);
    return [byte(base[0] + grain - wet), byte(base[1] + grain * 0.82 - wet), byte(base[2] + grain * 0.58 - wet)];
  }
}
