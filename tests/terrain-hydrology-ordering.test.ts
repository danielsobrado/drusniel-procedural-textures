import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTerrainFields, buildTerrainFieldsChunked } from '../src/tile/TerrainHydrology';
import type { TerrainSettings } from '../src/tile/TerrainTypes';

const SETTINGS: TerrainSettings = {
  seed: 1,
  mountainCoverage: 0.4,
  mountainHeight: 0.6,
  ridgeSharpness: 1.6,
  detail: 0.2,
  riverDensity: 0.5,
  riverDepth: 0.04,
  wetnessRadius: 3,
  materialRepeat: 24
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function comparatorOrder(height: Float32Array): number[] {
  const order = Array.from({ length: height.length }, (_, index) => index);
  order.sort((left, right) => (height[right] ?? 0) - (height[left] ?? 0));
  return order;
}

function accumulateInOrder(height: Float32Array, size: number, order: readonly number[]): Float32Array {
  const wrap = (value: number): number => (value + size) % size;
  const target = new Int32Array(height.length).fill(-1);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      let best = height[index] ?? 0;
      let bestIndex = -1;
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const candidateIndex = wrap(y + (dy ?? 0)) * size + wrap(x + (dx ?? 0));
        const candidate = height[candidateIndex] ?? 0;
        if (candidate < best) {
          best = candidate;
          bestIndex = candidateIndex;
        }
      }
      target[index] = bestIndex;
    }
  }
  const accumulation = new Float32Array(height.length).fill(1);
  for (const index of order) {
    const next = target[index] ?? -1;
    if (next >= 0) accumulation[next] = (accumulation[next] ?? 1) + (accumulation[index] ?? 1);
  }
  return accumulation;
}

function normalize(accumulation: Float32Array): Float32Array {
  let maximum = 1;
  for (const value of accumulation) maximum = Math.max(maximum, value);
  if (maximum <= 1) return new Float32Array(accumulation.length);
  const denominator = Math.log1p(maximum);
  const flow = new Float32Array(accumulation.length);
  for (let index = 0; index < accumulation.length; index += 1) {
    flow[index] = Math.log1p(accumulation[index] ?? 1) / denominator;
  }
  return flow;
}

function field(size: number, sample: (x: number, y: number) => number): Float32Array {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) height[y * size + x] = sample(x, y);
  }
  return height;
}

describe('terrain drainage ordering', () => {
  const size = 24;
  const cases: ReadonlyArray<readonly [string, Float32Array]> = [
    ['smooth gradient', field(size, (x, y) => (x + y) / (size * 2))],
    ['tie-heavy plateaus', field(size, (x, y) => Math.round(((x * 7 + y * 3) % 5) / 4 * 4) / 4)],
    ['single flat plateau', field(size, () => 0.5)],
    ['all zero', field(size, () => 0)]
  ];

  for (const [label, height] of cases) {
    it(`matches the comparator traversal for a ${label} field`, () => {
      const expected = normalize(accumulateInOrder(height, size, comparatorOrder(height)));
      const actual = buildTerrainFields(height, size, SETTINGS, 'cpu').flow;
      expect(Array.from(actual)).toEqual(Array.from(expected));
    });
  }

  it('keeps every derived field finite and in range', () => {
    const fields = buildTerrainFields(cases[1]![1], size, SETTINGS, 'cpu');
    for (const values of [fields.height, fields.slope, fields.flow, fields.river, fields.wetness]) {
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the cooperative path byte-for-byte equivalent while yielding', async () => {
    const height = cases[1]![1];
    const expected = buildTerrainFields(height, size, SETTINGS, 'cpu');
    let now = 0;
    const yieldTask = vi.fn(async () => undefined);
    vi.stubGlobal('performance', {
      now: () => {
        now += 3;
        return now;
      }
    });
    vi.stubGlobal('scheduler', { yield: yieldTask });

    const actual = await buildTerrainFieldsChunked(height, size, SETTINGS, 'cpu');

    for (const key of ['height', 'slope', 'flow', 'river', 'wetness', 'material'] as const) {
      expect(Array.from(actual[key])).toEqual(Array.from(expected[key]));
    }
    expect(yieldTask).toHaveBeenCalled();
  });
});
