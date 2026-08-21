import { describe, expect, it } from 'vitest';
import {
  measurePixelSeamMismatch,
  rebuildNormalPixelsFromHeight
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

    expect(measurePixelSeamMismatch(pixels, 4, 3)).toBeGreaterThan(0.05);
  });

  it('reports zero for matching values and slopes across the repeat boundary', () => {
    const row = [100, 150, 50, 100] as const;
    const pixels = grayscaleTexture([row, row, row]);

    expect(measurePixelSeamMismatch(pixels, 4, 3)).toBe(0);
  });
});
