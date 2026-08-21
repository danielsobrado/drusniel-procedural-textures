import type { BakedTexture, BakedTextureSet } from './TextureBaker';

export interface SeamlessTextureOptions {
  blendFraction: number;
  worldSize: number;
  displacementExtent: number;
}

const CHANNEL_COUNT = 4;
const NORMAL_Z = 1;

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    throw new Error('Browser does not provide the 2D canvas required for seamless texture export.');
  }
  return context;
}

function smootherStep(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function blendPair(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  firstOffset: number,
  secondOffset: number,
  keep: number
): void {
  const mix = 1 - keep;
  for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
    const first = source[firstOffset + channel]!;
    const second = source[secondOffset + channel]!;
    target[firstOffset + channel] = Math.round(first * keep + second * mix);
    target[secondOffset + channel] = Math.round(second * keep + first * mix);
  }
}

function blendHorizontalEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blendPixels: number
): void {
  const source = new Uint8ClampedArray(pixels);
  const denominator = Math.max(blendPixels - 1, 1);
  for (let y = 0; y < height; y += 1) {
    for (let distance = 0; distance < blendPixels; distance += 1) {
      const leftX = distance;
      const rightX = width - 1 - distance;
      if (leftX > rightX) break;
      const keep = 0.5 + smootherStep(distance / denominator) * 0.5;
      blendPair(
        source,
        pixels,
        (y * width + leftX) * CHANNEL_COUNT,
        (y * width + rightX) * CHANNEL_COUNT,
        keep
      );
    }
  }
}

function blendVerticalEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blendPixels: number
): void {
  const source = new Uint8ClampedArray(pixels);
  const denominator = Math.max(blendPixels - 1, 1);
  for (let x = 0; x < width; x += 1) {
    for (let distance = 0; distance < blendPixels; distance += 1) {
      const topY = distance;
      const bottomY = height - 1 - distance;
      if (topY > bottomY) break;
      const keep = 0.5 + smootherStep(distance / denominator) * 0.5;
      blendPair(
        source,
        pixels,
        (topY * width + x) * CHANNEL_COUNT,
        (bottomY * width + x) * CHANNEL_COUNT,
        keep
      );
    }
  }
}

function averagePair(
  pixels: Uint8ClampedArray,
  firstOffset: number,
  secondOffset: number
): void {
  for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
    const average = Math.round((pixels[firstOffset + channel]! + pixels[secondOffset + channel]!) * 0.5);
    pixels[firstOffset + channel] = average;
    pixels[secondOffset + channel] = average;
  }
}

function lockOuterEdges(pixels: Uint8ClampedArray, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    averagePair(
      pixels,
      (y * width) * CHANNEL_COUNT,
      (y * width + width - 1) * CHANNEL_COUNT
    );
  }
  for (let x = 0; x < width; x += 1) {
    averagePair(
      pixels,
      x * CHANNEL_COUNT,
      ((height - 1) * width + x) * CHANNEL_COUNT
    );
  }
}

function normalizeNormalPixels(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += CHANNEL_COUNT) {
    let x = pixels[offset]! / 127.5 - 1;
    let y = pixels[offset + 1]! / 127.5 - 1;
    let z = pixels[offset + 2]! / 127.5 - 1;
    const length = Math.hypot(x, y, z);
    if (length <= 1e-8) {
      x = 0;
      y = 0;
      z = 1;
    } else {
      x /= length;
      y /= length;
      z /= length;
    }
    pixels[offset] = Math.round((x * 0.5 + 0.5) * 255);
    pixels[offset + 1] = Math.round((y * 0.5 + 0.5) * 255);
    pixels[offset + 2] = Math.round((z * 0.5 + 0.5) * 255);
    pixels[offset + 3] = 255;
  }
}

function heightAt(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  displacementExtent: number
): number {
  const wrappedX = (x + width) % width;
  const wrappedY = (y + height) % height;
  const value = pixels[(wrappedY * width + wrappedX) * CHANNEL_COUNT]! / 255;
  return (value - 0.5) * displacementExtent * 2;
}

function rebuildNormalFromHeight(
  normal: BakedTexture,
  height: BakedTexture,
  worldSize: number,
  displacementExtent: number
): void {
  const width = height.canvas.width;
  const canvasHeight = height.canvas.height;
  if (normal.canvas.width !== width || normal.canvas.height !== canvasHeight) {
    throw new Error('Normal and height texture dimensions do not match.');
  }

  const heightPixels = canvasContext(height.canvas).getImageData(0, 0, width, canvasHeight).data;
  const output = new ImageData(width, canvasHeight);
  const pixelWorldX = worldSize / width;
  const pixelWorldY = worldSize / canvasHeight;

  for (let y = 0; y < canvasHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slopeX = (
        heightAt(heightPixels, width, canvasHeight, x + 1, y, displacementExtent) -
        heightAt(heightPixels, width, canvasHeight, x - 1, y, displacementExtent)
      ) / (2 * pixelWorldX);
      const slopeCanvasY = (
        heightAt(heightPixels, width, canvasHeight, x, y + 1, displacementExtent) -
        heightAt(heightPixels, width, canvasHeight, x, y - 1, displacementExtent)
      ) / (2 * pixelWorldY);

      let normalX = -slopeX;
      let normalY = slopeCanvasY;
      let normalZ = NORMAL_Z;
      const length = Math.hypot(normalX, normalY, normalZ);
      normalX /= length;
      normalY /= length;
      normalZ /= length;

      const offset = (y * width + x) * CHANNEL_COUNT;
      output.data[offset] = Math.round((normalX * 0.5 + 0.5) * 255);
      output.data[offset + 1] = Math.round((normalY * 0.5 + 0.5) * 255);
      output.data[offset + 2] = Math.round((normalZ * 0.5 + 0.5) * 255);
      output.data[offset + 3] = 255;
    }
  }

  lockOuterEdges(output.data, width, canvasHeight);
  normalizeNormalPixels(output.data);
  canvasContext(normal.canvas).putImageData(output, 0, 0);
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('Browser failed to encode the seamless PNG texture.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

async function seamTexture(texture: BakedTexture, blendFraction: number): Promise<void> {
  const width = texture.canvas.width;
  const height = texture.canvas.height;
  const context = canvasContext(texture.canvas);
  const image = context.getImageData(0, 0, width, height);
  const maxBlend = Math.max(2, Math.floor(Math.min(width, height) * 0.5));
  const blendPixels = Math.min(
    maxBlend,
    Math.max(2, Math.round(Math.min(width, height) * blendFraction))
  );

  blendHorizontalEdges(image.data, width, height, blendPixels);
  blendVerticalEdges(image.data, width, height, blendPixels);
  lockOuterEdges(image.data, width, height);
  context.putImageData(image, 0, 0);
  texture.blob = await canvasToPng(texture.canvas);
}

export async function makeTextureSetSeamless(
  textures: BakedTextureSet,
  options: Readonly<SeamlessTextureOptions>
): Promise<BakedTextureSet> {
  if (!Number.isFinite(options.blendFraction) || options.blendFraction <= 0 || options.blendFraction >= 0.5) {
    throw new Error('Seam blend fraction must be greater than 0 and less than 0.5.');
  }
  if (!Number.isFinite(options.worldSize) || options.worldSize <= 0) {
    throw new Error('Tile world size must be greater than zero.');
  }
  if (!Number.isFinite(options.displacementExtent) || options.displacementExtent < 0) {
    throw new Error('Displacement extent cannot be negative.');
  }

  await seamTexture(textures.albedo, options.blendFraction);
  await seamTexture(textures.roughness, options.blendFraction);
  await seamTexture(textures.height, options.blendFraction);
  await seamTexture(textures.clearcoat, options.blendFraction);
  await seamTexture(textures.clearcoatRoughness, options.blendFraction);

  rebuildNormalFromHeight(
    textures.normal,
    textures.height,
    options.worldSize,
    options.displacementExtent
  );
  textures.normal.blob = await canvasToPng(textures.normal.canvas);
  return textures;
}

export function measureEdgeMismatch(canvas: HTMLCanvasElement): number {
  const width = canvas.width;
  const height = canvas.height;
  const pixels = canvasContext(canvas).getImageData(0, 0, width, height).data;
  let difference = 0;
  let samples = 0;

  for (let y = 0; y < height; y += 1) {
    const left = (y * width) * CHANNEL_COUNT;
    const right = (y * width + width - 1) * CHANNEL_COUNT;
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(pixels[left + channel]! - pixels[right + channel]!);
      samples += 1;
    }
  }
  for (let x = 0; x < width; x += 1) {
    const top = x * CHANNEL_COUNT;
    const bottom = ((height - 1) * width + x) * CHANNEL_COUNT;
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(pixels[top + channel]! - pixels[bottom + channel]!);
      samples += 1;
    }
  }

  return samples === 0 ? 0 : difference / (samples * 255);
}
