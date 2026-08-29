import { describe, expect, it } from 'vitest';
import { rebuildNormalPixelsFromHeight } from '../src/export/SeamlessTexture';

/**
 * Normal reconstruction is the slowest CPU pass in a seamless export, so it attracts
 * optimisation - and it feeds every exported normal map, so drift there is a silent quality
 * regression. These digests were taken from the implementation that used per-sample modulo
 * wrapping, and were verified byte-for-byte against it. Any change that moves a single byte
 * fails here, which is the point: a faster rebuild has to produce the same texture.
 *
 * A worked example of why this matters: substituting Math.sqrt for Math.hypot inside the
 * slope normalisation looked safe and passed 4M random samples, but moved three bytes by one
 * at 256 squared. That substitution was reverted; the one in normalizeNormalPixel, whose
 * domain is the finite set of byte triples, was checked exhaustively and kept.
 */
function heightPixels(size: number, seed: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  let state = seed;
  const random = (): number => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let index = 0; index < size * size; index += 1) {
    // Mixing noise with smooth gradients exercises both flat regions and the steep slopes
    // where rounding sits closest to a boundary.
    const value = index % 3 === 0
      ? random() * 255
      : (Math.sin(index * 0.013) * 0.5 + 0.5) * 255;
    pixels[index * 4] = value;
    pixels[index * 4 + 1] = value;
    pixels[index * 4 + 2] = value;
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

function digest(data: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < data.length; index += 1) {
    hash ^= data[index]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

describe('seamless normal rebuild output', () => {
  const cases: ReadonlyArray<readonly [number, number, string]> = [
      [2, 0, 'cb86319d'],
      [2, 0.001, 'cb86319d'],
      [2, 0.25, 'cb86319d'],
      [2, 3.5, 'cb86319d'],
      [3, 0, 'e7e28b9b'],
      [3, 0.001, 'e7e28b9b'],
      [3, 0.25, 'e7e28b9b'],
      [3, 3.5, 'e7e28b9b'],
      [5, 0, 'de89edfb'],
      [5, 0.001, '07deeb0c'],
      [5, 0.25, 'b455684d'],
      [5, 3.5, '2d7f6443'],
      [16, 0, '6fba67c5'],
      [16, 0.001, '0ed91285'],
      [16, 0.25, '4fd3f298'],
      [16, 3.5, '27cafed6'],
      [64, 0, 'cdf93dc5'],
      [64, 0.001, '64b9259f'],
      [64, 0.25, '7b42c097'],
      [64, 3.5, '50abe07c'],
      [127, 0, '442613eb'],
      [127, 0.001, '5a5f8679'],
      [127, 0.25, '22f5a79a'],
      [127, 3.5, '3ae6eb18'],
      [256, 0, '4ee69dc5'],
      [256, 0.001, 'd9620aab'],
      [256, 0.25, '8d69c17a'],
      [256, 3.5, 'c7b6b0db']
  ];

  for (const [size, extent, expected] of cases) {
    it(`is unchanged at ${size} squared with displacement extent ${extent}`, () => {
      const pixels = heightPixels(size, size * 7 + 1);
      const normals = rebuildNormalPixelsFromHeight(pixels, size, size, 2.5, extent);
      expect(digest(normals)).toBe(expected);
    });
  }

  it('keeps the periodic seam convention that wraps modulo size minus one', () => {
    // A tile repeats its outer edge, so column width-1 must resolve to column 0. If the wrap
    // table ever drifted to modulo size, the two edges would stop matching.
    const size = 32;
    const pixels = heightPixels(size, 5);
    const normals = rebuildNormalPixelsFromHeight(pixels, size, size, 2.5, 0.25);
    for (let y = 0; y < size; y += 1) {
      const left = (y * size) * 4;
      const right = (y * size + size - 1) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        expect(normals[right + channel]).toBe(normals[left + channel]);
      }
    }
  });
});
