import { describe, expect, it } from 'vitest';
import {
  makeTextureSeamless,
  measurePixelSeamMismatch,
  rebuildNormalPixelsFromHeight,
  stabilizePixelSeamSlopes
} from '../src/export/SeamlessTexture';

const CHANNELS = 4;

function grayscaleTexture(rows: readonly (readonly number[])[]): Uint8ClampedArray {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const pixels = new Uint8ClampedArray(width * height * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    if (row === undefined || row.length !== width) throw new Error('Texture rows must have equal width.');
    for (let x = 0; x < width; x += 1) {
      const value = row[x] ?? 0;
      const offset = (y * width + x) * CHANNELS;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

describe('seamless texture processing', () => {
  it('rejects invalid single-texture blend fractions before touching the canvas', async () => {
    const texture = { canvas: null as unknown as HTMLCanvasElement };

    await expect(makeTextureSeamless(texture, 0)).rejects.toThrow(
      'Seam blend fraction must be greater than 0 and less than 0.5.'
    );
  });

  it('reconstructs the full periodic height slope at duplicated tile edges', () => {
    const row = [128, 255, 128, 0, 128] as const;
    const heightPixels = grayscaleTexture([row, row, row]);
    const normals = rebuildNormalPixelsFromHeight(heightPixels, 5, 3, 4, 1);

    const leftRed = normals[0];
    const rightRed = normals[(5 - 1) * CHANNELS];
    const leftGreen = normals[1];

    expect(leftRed).toBeLessThan(45);
    expect(rightRed).toBe(leftRed);
    expect(leftGreen).toBeGreaterThanOrEqual(126);
    expect(leftGreen).toBeLessThanOrEqual(129);
  });

  it('detects a derivative seam even when opposite edge values match', () => {
    const row = [100, 200, 50, 100] as const;
    const pixels = grayscaleTexture([row, row, row]);

    expect(measurePixelSeamMismatch(pixels, 4, 3)).toBeGreaterThan(0.04);
  });

  it('reports zero for matching values and slopes across the repeat boundary', () => {
    const row = [100, 150, 50, 100] as const;
    const pixels = grayscaleTexture([row, row, row]);

    expect(measurePixelSeamMismatch(pixels, 4, 3)).toBe(0);
  });

  it('reduces derivative seams without flattening the interior', () => {
    const row = [40, 220, 80, 150, 200] as const;
    const rows = Array.from({ length: 64 }, () => row);
    const pixels = grayscaleTexture(rows);
    const before = measurePixelSeamMismatch(pixels, row.length, rows.length);
    const interiorOffset = (32 * row.length + 2) * CHANNELS;
    const interiorBefore = pixels[interiorOffset];

    stabilizePixelSeamSlopes(pixels, row.length, rows.length);

    expect(measurePixelSeamMismatch(pixels, row.length, rows.length)).toBeLessThan(before * 0.1);
    expect(pixels[interiorOffset]).toBe(interiorBefore);
  });
});
