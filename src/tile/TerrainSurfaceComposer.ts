import { TERRAIN_CONFIG } from '../config/terrainConfig';
import {
  TERRAIN_MATERIALS,
  type TerrainPbrTextureSet,
  type TerrainFields,
  type TerrainPaintMask,
  type TerrainTextureSource,
  type TerrainViewMode
} from './TerrainTypes';

const NO_MATERIAL = 255;
const REPEAT_PREVIEW_TILES = 3;
const WATER: readonly [number, number, number] = [35, 82, 101];
const TAU = Math.PI * 2;

function byte(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function fract(value: number): number { return value - Math.floor(value); }
function noise(x: number, y: number): number { return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453); }
function fieldIndex(u: number, v: number, size: number): number {
  return Math.min(size - 1, Math.floor(fract(v) * size)) * size + Math.min(size - 1, Math.floor(fract(u) * size));
}

function resizePreviewCanvas(canvas: HTMLCanvasElement): boolean {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const requestedRatio = Math.min(window.devicePixelRatio, 2);
  const boundedRatio = Math.sqrt(TERRAIN_CONFIG.preview.maxPixels / Math.max(1, bounds.width * bounds.height));
  const ratio = Math.min(requestedRatio, boundedRatio);
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return true;
}

function drawRepeatGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.strokeStyle = 'rgba(235,240,255,.18)';
  context.lineWidth = Math.max(1, Math.min(window.devicePixelRatio, 2));
  for (let tile = 1; tile < REPEAT_PREVIEW_TILES; tile += 1) {
    const x = width * tile / REPEAT_PREVIEW_TILES;
    const y = height * tile / REPEAT_PREVIEW_TILES;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function writeTextureColor(
  out: Float64Array,
  texture: Readonly<TerrainTextureSource>,
  u: number,
  v: number
): void {
  const tx = Math.floor(fract(u) * texture.width) % texture.width;
  const ty = Math.floor(fract(v) * texture.height) % texture.height;
  const source = (ty * texture.width + tx) * 4;
  out[0] = texture.pixels[source] ?? 0;
  out[1] = texture.pixels[source + 1] ?? 0;
  out[2] = texture.pixels[source + 2] ?? 0;
}

function writeFallbackRepeatColor(
  out: Float64Array,
  materialIndex: number,
  u: number,
  v: number
): void {
  const base = (TERRAIN_MATERIALS[materialIndex] ?? TERRAIN_MATERIALS[0]!).color;
  const localU = fract(u);
  const localV = fract(v);
  const grain = (
    Math.sin(localU * TAU * 5) +
    Math.cos(localV * TAU * 7) +
    Math.sin((localU + localV) * TAU * 3)
  ) * 2.4;
  out[0] = byte(base[0] + grain);
  out[1] = byte(base[1] + grain * 0.82);
  out[2] = byte(base[2] + grain * 0.58);
}

export class TerrainSurfaceComposer {
  private readonly textures = new Map<number, TerrainPbrTextureSet>();
  private readonly autoColor = new Float64Array(3);
  private readonly overrideColor = new Float64Array(3);
  private readonly repeatColor = new Float64Array(3);
  private fallbackFields: Readonly<TerrainFields> | null = null;
  private fallbackGrain = new Float32Array(0);

  public setTextures(materialIndex: number, textures: TerrainPbrTextureSet | null): void {
    if (textures === null) this.textures.delete(materialIndex);
    else this.textures.set(materialIndex, textures);
  }

  public renderPreview(
    canvas: HTMLCanvasElement,
    fields: Readonly<TerrainFields>,
    paint: Readonly<TerrainPaintMask>,
    view: TerrainViewMode,
    materialRepeat: number
  ): void {
    if (!resizePreviewCanvas(canvas)) return;
    this.render(canvas, fields, paint, view, materialRepeat, true);
  }

  public renderMaterialRepeatPreview(canvas: HTMLCanvasElement, materialIndex: number): void {
    if (!resizePreviewCanvas(canvas)) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    const image = context.createImageData(canvas.width, canvas.height);
    const data = image.data;
    const texture = this.textures.get(materialIndex)?.albedo;
    for (let y = 0; y < canvas.height; y += 1) {
      const v = ((y + 0.5) / canvas.height) * REPEAT_PREVIEW_TILES;
      for (let x = 0; x < canvas.width; x += 1) {
        const u = ((x + 0.5) / canvas.width) * REPEAT_PREVIEW_TILES;
        if (texture === undefined) {
          writeFallbackRepeatColor(this.repeatColor, materialIndex, u, v);
        } else {
          writeTextureColor(this.repeatColor, texture, u, v);
        }
        const target = (y * canvas.width + x) * 4;
        data[target] = byte(this.repeatColor[0] ?? 0);
        data[target + 1] = byte(this.repeatColor[1] ?? 0);
        data[target + 2] = byte(this.repeatColor[2] ?? 0);
        data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    drawRepeatGrid(context, canvas.width, canvas.height);
  }

  public createMaterialCanvas(
    fields: Readonly<TerrainFields>,
    paint: Readonly<TerrainPaintMask>,
    materialRepeat: number,
    size = 512,
    decorateMap = true
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    this.render(canvas, fields, paint, 'material', materialRepeat, decorateMap);
    return canvas;
  }

  private render(
    canvas: HTMLCanvasElement,
    fields: Readonly<TerrainFields>,
    paint: Readonly<TerrainPaintMask>,
    view: TerrainViewMode,
    materialRepeat: number,
    decorateMap: boolean
  ): void {
    const context = canvas.getContext('2d');
    if (context === null) return;
    if (view === 'material') this.prepareFallbackGrain(fields);

    const image = context.createImageData(canvas.width, canvas.height);
    const data = image.data;
    for (let y = 0; y < canvas.height; y += 1) {
      const v = (y + 0.5) / canvas.height;
      for (let x = 0; x < canvas.width; x += 1) {
        const u = (x + 0.5) / canvas.width;
        const index = fieldIndex(u, v, fields.resolution);
        const target = (y * canvas.width + x) * 4;
        this.writeColorAt(data, target, fields, paint, index, u, v, view, materialRepeat, decorateMap);
        data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  private writeColorAt(
    data: Uint8ClampedArray,
    target: number,
    fields: Readonly<TerrainFields>,
    paint: Readonly<TerrainPaintMask>,
    index: number,
    u: number,
    v: number,
    view: TerrainViewMode,
    materialRepeat: number,
    decorateMap: boolean
  ): void {
    if (view === 'height') {
      const n = byte((fields.height[index] ?? 0) * 255);
      data[target] = n; data[target + 1] = n; data[target + 2] = n;
      return;
    }
    if (view === 'slope') {
      const n = fields.slope[index] ?? 0;
      data[target] = byte(42 + n * 205);
      data[target + 1] = byte(48 + n * 116);
      data[target + 2] = byte(58 + n * 65);
      return;
    }
    if (view === 'flow') {
      const n = fields.flow[index] ?? 0;
      data[target] = byte(20 + n * 75);
      data[target + 1] = byte(35 + n * 145);
      data[target + 2] = byte(50 + n * 200);
      return;
    }
    if (view === 'river') {
      const n = fields.river[index] ?? 0;
      data[target] = byte(16 + n * 40);
      data[target + 1] = byte(28 + n * 110);
      data[target + 2] = byte(36 + n * 175);
      return;
    }
    if (view === 'wetness') {
      const n = fields.wetness[index] ?? 0;
      data[target] = byte(35 + n * 55);
      data[target + 1] = byte(45 + n * 105);
      data[target + 2] = byte(43 + n * 125);
      return;
    }

    const autoIndex = fields.material[index] ?? 0;
    const overrideIndex = paint.material[index] ?? NO_MATERIAL;
    const weight = overrideIndex === NO_MATERIAL ? 0 : paint.weight[index] ?? 0;

    this.writeMaterialColor(this.autoColor, autoIndex, u, v, fields, index, materialRepeat);
    const auto = this.autoColor;
    let override = auto;
    if (overrideIndex !== NO_MATERIAL) {
      this.writeMaterialColor(this.overrideColor, overrideIndex, u, v, fields, index, materialRepeat);
      override = this.overrideColor;
    }

    const river = decorateMap ? Math.min(0.92, (fields.river[index] ?? 0) * 0.94) : 0;
    const shade = decorateMap ? 1 - (fields.slope[index] ?? 0) * 0.18 : 1;
    data[target] = byte(mix(mix(auto[0]!, override[0]!, weight) * shade, WATER[0], river));
    data[target + 1] = byte(mix(mix(auto[1]!, override[1]!, weight) * shade, WATER[1], river));
    data[target + 2] = byte(mix(mix(auto[2]!, override[2]!, weight) * shade, WATER[2], river));
  }

  private writeMaterialColor(
    out: Float64Array,
    materialIndex: number,
    u: number,
    v: number,
    fields: Readonly<TerrainFields>,
    index: number,
    materialRepeat: number
  ): void {
    const texture = this.textures.get(materialIndex)?.albedo;
    if (texture !== undefined) {
      writeTextureColor(out, texture, u * materialRepeat, v * materialRepeat);
      return;
    }
    const base = (TERRAIN_MATERIALS[materialIndex] ?? TERRAIN_MATERIALS[0]!).color;
    const grain = this.fallbackGrain[index] ?? 0;
    const wet = (fields.wetness[index] ?? 0) * (materialIndex === 2 ? 20 : 5);
    out[0] = byte(base[0] + grain - wet);
    out[1] = byte(base[1] + grain * 0.82 - wet);
    out[2] = byte(base[2] + grain * 0.58 - wet);
  }

  private prepareFallbackGrain(fields: Readonly<TerrainFields>): void {
    if (this.fallbackFields === fields && this.fallbackGrain.length === fields.height.length) return;

    const grain = new Float32Array(fields.height.length);
    for (let index = 0; index < grain.length; index += 1) {
      const x = index % fields.resolution;
      const y = Math.floor(index / fields.resolution);
      grain[index] = (noise(x, y) - 0.5) * 18;
    }
    this.fallbackFields = fields;
    this.fallbackGrain = grain;
  }
}
