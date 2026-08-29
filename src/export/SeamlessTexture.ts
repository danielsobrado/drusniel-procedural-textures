import { createFrameBudget } from '../utils/scheduling';
import type { BakedTexture, BakedTextureSet } from './TextureBaker';

export interface SeamlessTextureOptions {
  blendFraction: number;
  worldSize: number;
  displacementExtent: number;
}

const CHANNEL_COUNT = 4;
const NORMAL_Z = 1;
const INNER_EDGE_OFFSET = 1;
const DISPLACEMENT_EXTENT = Symbol('seamless-displacement-extent');

type TextureSetWithMetadata = BakedTextureSet & {
  [DISPLACEMENT_EXTENT]?: number;
};

export function rememberTextureSetDisplacementExtent(
  textures: BakedTextureSet,
  displacementExtent: number
): void {
  if (!Number.isFinite(displacementExtent) || displacementExtent < 0) {
    throw new Error('Displacement extent cannot be negative.');
  }
  (textures as TextureSetWithMetadata)[DISPLACEMENT_EXTENT] = displacementExtent;
}

function displacementExtentFor(
  textures: BakedTextureSet,
  fallback: number
): number {
  const remembered = (textures as TextureSetWithMetadata)[DISPLACEMENT_EXTENT];
  return remembered ?? fallback;
}

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

/**
 * Yields periodically: at a 2048 bake this is ~671k blendPair calls, which ran as one
 * unbroken block and stalled the frame (and any progress bar) for its whole duration.
 */
async function blendHorizontalEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blendPixels: number
): Promise<void> {
  const source = new Uint8ClampedArray(pixels);
  const denominator = Math.max(blendPixels - 1, 1);
  const budget = createFrameBudget();
  for (let y = 0; y < height; y += 1) {
    if (budget.isDue()) await budget.yieldIfDue();
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

async function blendVerticalEdges(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blendPixels: number
): Promise<void> {
  const source = new Uint8ClampedArray(pixels);
  const denominator = Math.max(blendPixels - 1, 1);
  const budget = createFrameBudget();
  for (let x = 0; x < width; x += 1) {
    if (budget.isDue()) await budget.yieldIfDue();
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

function symmetricDelta(edge: number, firstInner: number, secondInner: number): number {
  const requested = (firstInner - secondInner) * 0.5;
  const maximum = Math.min(edge, 255 - edge);
  return Math.min(Math.max(requested, -maximum), maximum);
}

function lockHorizontalSlopes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): void {
  if (width < 3) return;

  for (let y = INNER_EDGE_OFFSET; y < height - INNER_EDGE_OFFSET; y += 1) {
    const leftEdge = (y * width) * CHANNEL_COUNT;
    const leftInner = (y * width + INNER_EDGE_OFFSET) * CHANNEL_COUNT;
    const rightInner = (y * width + width - 1 - INNER_EDGE_OFFSET) * CHANNEL_COUNT;

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const edge = pixels[leftEdge + channel]!;
      const delta = symmetricDelta(
        edge,
        pixels[leftInner + channel]!,
        pixels[rightInner + channel]!
      );
      pixels[leftInner + channel] = Math.round(edge + delta);
      pixels[rightInner + channel] = Math.round(edge - delta);
    }
  }
}

function lockVerticalSlopes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): void {
  if (height < 3) return;

  for (let x = INNER_EDGE_OFFSET; x < width - INNER_EDGE_OFFSET; x += 1) {
    const topEdge = x * CHANNEL_COUNT;
    const topInner = (INNER_EDGE_OFFSET * width + x) * CHANNEL_COUNT;
    const bottomInner = ((height - 1 - INNER_EDGE_OFFSET) * width + x) * CHANNEL_COUNT;

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const edge = pixels[topEdge + channel]!;
      const delta = symmetricDelta(
        edge,
        pixels[topInner + channel]!,
        pixels[bottomInner + channel]!
      );
      pixels[topInner + channel] = Math.round(edge + delta);
      pixels[bottomInner + channel] = Math.round(edge - delta);
    }
  }
}

export function stabilizePixelSeamSlopes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): void {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Seam stabilization requires positive integer texture dimensions.');
  }
  if (pixels.length !== width * height * CHANNEL_COUNT) {
    throw new Error('Pixel data does not match the supplied texture dimensions.');
  }

  lockOuterEdges(pixels, width, height);
  lockHorizontalSlopes(pixels, width, height);
  lockVerticalSlopes(pixels, width, height);
  lockOuterEdges(pixels, width, height);
}

function normalizeNormalPixel(pixels: Uint8ClampedArray, offset: number): void {
  let x = pixels[offset]! / 127.5 - 1;
  let y = pixels[offset + 1]! / 127.5 - 1;
  let z = pixels[offset + 2]! / 127.5 - 1;
  // Math.hypot guards against intermediate overflow, which costs several times a plain square
  // root. This input is byte-derived, so the domain is the finite set of 256^3 triples and
  // cannot overflow; every one was checked to round to the same three bytes either way.
  // rebuildNormalRow keeps Math.hypot - its slopes are unbounded and the two do differ there.
  const length = Math.sqrt(x * x + y * y + z * z);
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

function normalizeNormalPixels(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += CHANNEL_COUNT) {
    normalizeNormalPixel(pixels, offset);
  }
}

async function normalizeNormalPixelsAsync(pixels: Uint8ClampedArray): Promise<void> {
  const budget = createFrameBudget();
  for (let offset = 0; offset < pixels.length; offset += CHANNEL_COUNT) {
    normalizeNormalPixel(pixels, offset);
    if (budget.isDue()) await budget.yieldIfDue();
  }
}

function periodicCoordinate(value: number, size: number): number {
  if (size <= 1) return 0;
  const period = size - 1;
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

function validateNormalRebuildInput(
  heightPixels: Uint8ClampedArray,
  width: number,
  height: number,
  worldSize: number,
  displacementExtent: number
): void {
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2) {
    throw new Error('Normal reconstruction requires texture dimensions of at least 2×2 pixels.');
  }
  if (heightPixels.length !== width * height * CHANNEL_COUNT) {
    throw new Error('Height pixel data does not match the supplied texture dimensions.');
  }
  if (!Number.isFinite(worldSize) || worldSize <= 0) {
    throw new Error('Tile world size must be greater than zero.');
  }
  if (!Number.isFinite(displacementExtent) || displacementExtent < 0) {
    throw new Error('Displacement extent cannot be negative.');
  }
}

/**
 * Maps an offset coordinate in [-1, size] to its periodic index. `periodicCoordinate` wraps
 * modulo size - 1, not size, because a seamless tile repeats its outer edge; this table keeps
 * that convention while replacing the two modulo operations each of the four neighbour reads
 * performed - eight integer divisions per pixel.
 */
function periodicIndexTable(size: number): Int32Array {
  const table = new Int32Array(size + 2);
  for (let offset = 0; offset < table.length; offset += 1) {
    table[offset] = periodicCoordinate(offset - 1, size);
  }
  return table;
}

function rebuildNormalRow(
  heightPixels: Uint8ClampedArray,
  output: Uint8ClampedArray,
  width: number,
  y: number,
  pixelWorldX: number,
  pixelWorldY: number,
  displacementExtent: number,
  wrapX: Int32Array,
  wrapY: Int32Array
): void {
  const centerRow = (wrapY[y + 1] ?? 0) * width;
  const upperRow = (wrapY[y] ?? 0) * width;
  const lowerRow = (wrapY[y + 2] ?? 0) * width;
  const spanX = 2 * pixelWorldX;
  const spanY = 2 * pixelWorldY;
  // Kept in the same arithmetic order as the heightAt calls this replaces, so the
  // floating-point results - and therefore every rounded byte - are unchanged.
  const sample = (index: number): number =>
    ((heightPixels[index * CHANNEL_COUNT]! / 255) - 0.5) * displacementExtent * 2;

  for (let x = 0; x < width; x += 1) {
    const column = wrapX[x + 1] ?? 0;
    const slopeX = (
      sample(centerRow + (wrapX[x + 2] ?? 0)) - sample(centerRow + (wrapX[x] ?? 0))
    ) / spanX;
    const slopeCanvasY = (sample(lowerRow + column) - sample(upperRow + column)) / spanY;

    let normalX = -slopeX;
    let normalY = slopeCanvasY;
    let normalZ = NORMAL_Z;
    const length = Math.hypot(normalX, normalY, normalZ);
    normalX /= length;
    normalY /= length;
    normalZ /= length;

    const offset = (y * width + x) * CHANNEL_COUNT;
    output[offset] = Math.round((normalX * 0.5 + 0.5) * 255);
    output[offset + 1] = Math.round((normalY * 0.5 + 0.5) * 255);
    output[offset + 2] = Math.round((normalZ * 0.5 + 0.5) * 255);
    output[offset + 3] = 255;
  }
}

export function rebuildNormalPixelsFromHeight(
  heightPixels: Uint8ClampedArray,
  width: number,
  height: number,
  worldSize: number,
  displacementExtent: number
): Uint8ClampedArray<ArrayBuffer> {
  validateNormalRebuildInput(heightPixels, width, height, worldSize, displacementExtent);
  const output = new Uint8ClampedArray(new ArrayBuffer(heightPixels.length));
  const pixelWorldX = worldSize / Math.max(width - 1, 1);
  const pixelWorldY = worldSize / Math.max(height - 1, 1);
  const wrapX = periodicIndexTable(width);
  const wrapY = periodicIndexTable(height);

  for (let y = 0; y < height; y += 1) {
    rebuildNormalRow(
      heightPixels, output, width, y, pixelWorldX, pixelWorldY, displacementExtent, wrapX, wrapY
    );
  }

  normalizeNormalPixels(output);
  stabilizePixelSeamSlopes(output, width, height);
  return output;
}

async function rebuildNormalPixelsFromHeightAsync(
  heightPixels: Uint8ClampedArray,
  width: number,
  height: number,
  worldSize: number,
  displacementExtent: number
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  validateNormalRebuildInput(heightPixels, width, height, worldSize, displacementExtent);
  const output = new Uint8ClampedArray(new ArrayBuffer(heightPixels.length));
  const pixelWorldX = worldSize / Math.max(width - 1, 1);
  const pixelWorldY = worldSize / Math.max(height - 1, 1);
  const budget = createFrameBudget();
  const wrapX = periodicIndexTable(width);
  const wrapY = periodicIndexTable(height);

  for (let y = 0; y < height; y += 1) {
    rebuildNormalRow(
      heightPixels, output, width, y, pixelWorldX, pixelWorldY, displacementExtent, wrapX, wrapY
    );
    if (budget.isDue()) await budget.yieldIfDue();
  }

  await normalizeNormalPixelsAsync(output);
  stabilizePixelSeamSlopes(output, width, height);
  return output;
}

async function rebuildNormalFromHeight(
  normal: BakedTexture,
  height: BakedTexture,
  worldSize: number,
  displacementExtent: number
): Promise<void> {
  const width = height.canvas.width;
  const canvasHeight = height.canvas.height;
  if (normal.canvas.width !== width || normal.canvas.height !== canvasHeight) {
    throw new Error('Normal and height texture dimensions do not match.');
  }

  const heightPixels = canvasContext(height.canvas).getImageData(0, 0, width, canvasHeight).data;
  const pixels = await rebuildNormalPixelsFromHeightAsync(
    heightPixels,
    width,
    canvasHeight,
    worldSize,
    displacementExtent
  );
  canvasContext(normal.canvas).putImageData(new ImageData(pixels, width, canvasHeight), 0, 0);
}

function validateBlendFraction(blendFraction: number): void {
  if (!Number.isFinite(blendFraction) || blendFraction <= 0 || blendFraction >= 0.5) {
    throw new Error('Seam blend fraction must be greater than 0 and less than 0.5.');
  }
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

  await blendHorizontalEdges(image.data, width, height, blendPixels);
  await blendVerticalEdges(image.data, width, height, blendPixels);
  stabilizePixelSeamSlopes(image.data, width, height);
  context.putImageData(image, 0, 0);
}

export async function makeTextureSeamless(
  texture: BakedTexture,
  blendFraction: number
): Promise<BakedTexture> {
  validateBlendFraction(blendFraction);
  await seamTexture(texture, blendFraction);
  return texture;
}

export async function makeTextureSetSeamless(
  textures: BakedTextureSet,
  options: Readonly<SeamlessTextureOptions>
): Promise<BakedTextureSet> {
  validateBlendFraction(options.blendFraction);
  if (!Number.isFinite(options.worldSize) || options.worldSize <= 0) {
    throw new Error('Tile world size must be greater than zero.');
  }
  if (!Number.isFinite(options.displacementExtent) || options.displacementExtent < 0) {
    throw new Error('Displacement extent cannot be negative.');
  }

  const displacementExtent = displacementExtentFor(textures, options.displacementExtent);
  await seamTexture(textures.albedo, options.blendFraction);
  await seamTexture(textures.roughness, options.blendFraction);
  await seamTexture(textures.height, options.blendFraction);
  await seamTexture(textures.clearcoat, options.blendFraction);
  await seamTexture(textures.clearcoatRoughness, options.blendFraction);
  await seamTexture(textures.metallic, options.blendFraction);
  await seamTexture(textures.ao, options.blendFraction);
  await seamTexture(textures.emissive, options.blendFraction);

  await rebuildNormalFromHeight(
    textures.normal,
    textures.height,
    options.worldSize,
    displacementExtent
  );
  return textures;
}

export function measurePixelSeamMismatch(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): number {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Seam measurement requires positive integer texture dimensions.');
  }
  if (pixels.length !== width * height * CHANNEL_COUNT) {
    throw new Error('Pixel data does not match the supplied texture dimensions.');
  }

  let difference = 0;
  let samples = 0;

  for (let y = 0; y < height; y += 1) {
    const left = (y * width) * CHANNEL_COUNT;
    const right = (y * width + width - 1) * CHANNEL_COUNT;
    const leftInner = (y * width + Math.min(1, width - 1)) * CHANNEL_COUNT;
    const rightInner = (y * width + Math.max(width - 2, 0)) * CHANNEL_COUNT;
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(pixels[left + channel]! - pixels[right + channel]!);
      samples += 1;
      if (width > 2) {
        const leftSlope = pixels[leftInner + channel]! - pixels[left + channel]!;
        const rightSlope = pixels[right + channel]! - pixels[rightInner + channel]!;
        difference += Math.abs(leftSlope - rightSlope);
        samples += 1;
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    const top = x * CHANNEL_COUNT;
    const bottom = ((height - 1) * width + x) * CHANNEL_COUNT;
    const topInner = (Math.min(1, height - 1) * width + x) * CHANNEL_COUNT;
    const bottomInner = (Math.max(height - 2, 0) * width + x) * CHANNEL_COUNT;
    for (let channel = 0; channel < 3; channel += 1) {
      difference += Math.abs(pixels[top + channel]! - pixels[bottom + channel]!);
      samples += 1;
      if (height > 2) {
        const topSlope = pixels[topInner + channel]! - pixels[top + channel]!;
        const bottomSlope = pixels[bottom + channel]! - pixels[bottomInner + channel]!;
        difference += Math.abs(topSlope - bottomSlope);
        samples += 1;
      }
    }
  }

  return samples === 0 ? 0 : difference / (samples * 255);
}

export function measureEdgeMismatch(canvas: HTMLCanvasElement): number {
  const width = canvas.width;
  const height = canvas.height;
  const pixels = canvasContext(canvas).getImageData(0, 0, width, height).data;
  return measurePixelSeamMismatch(pixels, width, height);
}
