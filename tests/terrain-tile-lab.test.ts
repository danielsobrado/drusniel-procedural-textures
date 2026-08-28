import { describe, expect, it } from 'vitest';
import { TerrainComputeEngine } from '../src/tile/TerrainComputeEngine';
import { TerrainGenerator } from '../src/tile/TerrainGenerator';
import { buildTerrainFields } from '../src/tile/TerrainHydrology';
import { TerrainPainter } from '../src/tile/TerrainPainter';
import {
  sampleTerrainHeight,
  wrapTerrainCoordinate
} from '../src/tile/TerrainPlayerController';
import { buildRiverAlphaData } from '../src/tile/TerrainRiverLayer';
import type { TerrainFields, TerrainSettings } from '../src/tile/TerrainTypes';

const SETTINGS: TerrainSettings = {
  seed: 42,
  mountainCoverage: 0.7,
  mountainHeight: 0.8,
  ridgeSharpness: 2.4,
  detail: 0.3,
  riverDensity: 0.55,
  riverDepth: 0.04,
  wetnessRadius: 3,
  materialRepeat: 24
};

describe('terrain tile lab', () => {
  it('snapshots settings before asynchronous terrain generation starts', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let captured: Readonly<TerrainSettings> | null = null;
    const generator = new TerrainGenerator();
    const target = generator as unknown as {
      compute: { generate: (settings: Readonly<TerrainSettings>) => Promise<{ height: Float32Array; backend: 'cpu' }> };
    };
    target.compute.generate = async (settings) => {
      captured = settings;
      await gate;
      return { height: new Float32Array(32 * 32), backend: 'cpu' };
    };
    const settings = { ...SETTINGS };

    const pending = generator.generate(settings, 32);
    settings.seed = 99;
    settings.riverDensity = 0.9;
    release();
    await pending;

    expect(captured).not.toBe(settings);
    expect(captured).toMatchObject({ seed: 42, riverDensity: 0.55 });
  });

  it('stops a superseded generation before hydrology work begins', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const generator = new TerrainGenerator();
    const target = generator as unknown as {
      compute: { generate: () => Promise<{ height: Float32Array; backend: 'cpu' }> };
    };
    target.compute.generate = async () => {
      await gate;
      return { height: new Float32Array(32 * 32), backend: 'cpu' };
    };
    const abort = new AbortController();

    const pending = generator.generate(SETTINGS, 32, undefined, abort.signal);
    abort.abort();
    release();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('generates deterministic bounded terrain', async () => {
    const engine = new TerrainComputeEngine();
    const first = await engine.generate(SETTINGS, 32);
    const second = await engine.generate(SETTINGS, 32);
    expect(first.height).toEqual(second.height);
    expect(first.height.every(Number.isFinite)).toBe(true);
    expect(first.height.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('normalizes terrain seeds to WebGPU u32 semantics', async () => {
    const engine = new TerrainComputeEngine();
    const signed = await engine.generate({ ...SETTINGS, seed: -1 }, 32);
    const unsigned = await engine.generate({ ...SETTINGS, seed: 0xffffffff }, 32);
    expect(signed.height).toEqual(unsigned.height);
  });

  it('keeps RPG terrain broad instead of producing needle peaks', async () => {
    const engine = new TerrainComputeEngine();
    const settings = {
      ...SETTINGS,
      mountainCoverage: 0.46,
      mountainHeight: 0.6,
      ridgeSharpness: 1.6,
      detail: 0.22
    };
    const result = await engine.generate(settings, 64);
    let maximumStep = 0;
    let extremeCount = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const index = y * 64 + x;
        const value = result.height[index] ?? 0;
        const right = result.height[y * 64 + ((x + 1) % 64)] ?? value;
        const down = result.height[((y + 1) % 64) * 64 + x] ?? value;
        maximumStep = Math.max(maximumStep, Math.abs(value - right), Math.abs(value - down));
        if (value > 0.85) extremeCount += 1;
      }
    }
    expect(maximumStep).toBeLessThan(0.18);
    expect(extremeCount / result.height.length).toBeLessThan(0.08);
  });

  it('derives finite periodic hydrology fields and terrain materials', () => {
    const size = 16;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] = 0.5 + Math.sin(x / size * Math.PI * 2) * 0.18 + Math.cos(y / size * Math.PI * 2) * 0.12;
      }
    }
    const fields = buildTerrainFields(height, size, SETTINGS, 'cpu');
    expect(fields.height).toHaveLength(size * size);
    expect(fields.flow.every(Number.isFinite)).toBe(true);
    expect(fields.river.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(fields.wetness.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(fields.material.every((value) => value <= 3)).toBe(true);
  });

  it('produces visible river ribbons at useful density', () => {
    const size = 32;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] = 0.2 + Math.abs(x - size / 2) / size * 0.6;
      }
    }
    const fields = buildTerrainFields(
      height,
      size,
      { ...SETTINGS, riverDensity: 0.8 },
      'cpu'
    );
    expect(fields.river.some((value) => value > 0.15)).toBe(true);
  });

  it('increases river coverage monotonically with density', () => {
    const size = 32;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] =
          0.5 +
          Math.sin(x / size * Math.PI * 2) * 0.18 +
          Math.cos(y / size * Math.PI * 2) * 0.12 +
          Math.sin((x + y) / size * Math.PI * 4) * 0.04;
      }
    }
    const sparse = buildTerrainFields(
      height,
      size,
      { ...SETTINGS, riverDensity: 0.15 },
      'cpu'
    );
    const dense = buildTerrainFields(
      height,
      size,
      { ...SETTINGS, riverDensity: 0.85 },
      'cpu'
    );
    const sparseCount = sparse.river.filter((value) => value > 0.15).length;
    const denseCount = dense.river.filter((value) => value > 0.15).length;
    expect(sparseCount).toBeGreaterThan(0);
    expect(denseCount).toBeGreaterThan(sparseCount);
  });

  it('widens rendered river water across wrapped tile edges', () => {
    const size = 8;
    const river = new Float32Array(size * size);
    river[4 * size] = 1;
    const alpha = buildRiverAlphaData(river, size, 2);
    expect(alpha[(4 * size + 7) * 4 + 1]).toBeGreaterThan(0);
    expect(alpha[(4 * size + 4) * 4 + 1]).toBe(0);
  });

  it('rejects invalid river alpha dimensions and widths', () => {
    expect(() => buildRiverAlphaData(new Float32Array(16), 0, 1)).toThrow();
    expect(() => buildRiverAlphaData(new Float32Array(15), 4, 1)).toThrow();
    expect(() => buildRiverAlphaData(new Float32Array(16), 4, 0)).toThrow();
    expect(() => buildRiverAlphaData(new Float32Array(16), 4, 5)).toThrow();
  });

  it('uses the recipe wetness radius when deriving terrain moisture', () => {
    const size = 16;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] = 0.5 + Math.sin(x / size * Math.PI * 2) * 0.18 + Math.cos(y / size * Math.PI * 2) * 0.12;
      }
    }
    const narrow = buildTerrainFields(height, size, { ...SETTINGS, wetnessRadius: 1 }, 'cpu');
    const broad = buildTerrainFields(height, size, { ...SETTINGS, wetnessRadius: 6 }, 'cpu');
    expect(broad.wetness).not.toEqual(narrow.wetness);
  });

  it('keeps perfectly flat terrain free from artificial rivers', () => {
    const fields = buildTerrainFields(new Float32Array(16 * 16).fill(0.5), 16, SETTINGS, 'cpu');
    expect(fields.flow.every((value) => value === 0)).toBe(true);
    expect(fields.river.every((value) => value === 0)).toBe(true);
  });

  it('allows river generation to be disabled', () => {
    const size = 16;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        height[y * size + x] = 0.5 + Math.sin(x / size * Math.PI * 2) * 0.2;
      }
    }
    const fields = buildTerrainFields(height, size, { ...SETTINGS, riverDensity: 0 }, 'cpu');
    expect(fields.river.every((value) => value === 0)).toBe(true);
  });

  it('wraps first-person movement across the periodic terrain domain', () => {
    expect(wrapTerrainCoordinate(5.2, 10)).toBeCloseTo(-4.8, 8);
    expect(wrapTerrainCoordinate(-5.2, 10)).toBeCloseTo(4.8, 8);
  });

  it('samples the same player ground height on repeated terrain tiles', () => {
    const fields: TerrainFields = {
      resolution: 2,
      height: new Float32Array([0.1, 0.8, 0.3, 0.6]),
      slope: new Float32Array(4),
      flow: new Float32Array(4),
      river: new Float32Array(4),
      wetness: new Float32Array(4),
      material: new Uint8Array(4),
      backend: 'cpu'
    };
    const first = sampleTerrainHeight(fields, -4.7, 1.3, 10, 2);
    const repeated = sampleTerrainHeight(fields, 5.3, 1.3, 10, 2);
    expect(repeated).toBeCloseTo(first, 8);
  });

  it('wraps paint strokes across terrain tile edges', () => {
    const painter = new TerrainPainter(32);
    painter.paint('rock', 0.01, 0.5, 0.08, 0.8, 1);
    const mask = painter.mask;
    const left = 16 * 32;
    const right = 16 * 32 + 31;
    expect(mask.weight[left]).toBeGreaterThan(0);
    expect(mask.weight[right]).toBeGreaterThan(0);
    expect(mask.material[left]).toBe(1);
    expect(mask.material[right]).toBe(1);
  });

  it('interpolates fast brush motion across the wrapped seam', () => {
    const painter = new TerrainPainter(64);
    painter.paint('rock', 0.92, 0.5, 0.035, 0.8, 1);
    painter.paintLine('rock', 0.92, 0.5, 0.08, 0.5, 0.035, 0.8, 1);
    const row = 32 * 64;
    expect(painter.mask.weight[row + 63]).toBeGreaterThan(0);
    expect(painter.mask.weight[row]).toBeGreaterThan(0);
    expect(painter.mask.weight[row + 3]).toBeGreaterThan(0);
  });

  it('normalizes captured brush positions outside the canvas', () => {
    const painter = new TerrainPainter(64);
    painter.paint('rock', 0.98, 0.5, 0.035, 0.8, 1);
    painter.paintLine('rock', 0.98, 0.5, 2.02, 0.5, 0.035, 0.8, 1);
    expect(painter.strokes.length).toBeLessThan(20);
    const row = 32 * 64;
    expect(painter.mask.weight[row]).toBeGreaterThan(0);
  });

  it('allows a new terrain material to repaint a strong previous override', () => {
    const painter = new TerrainPainter(32);
    painter.paint('rock', 0.5, 0.5, 0.1, 1, 1);
    painter.paint('mud', 0.5, 0.5, 0.1, 1, 0.6);
    const center = 16 * 32 + 16;
    expect(painter.mask.material[center]).toBe(2);
    expect(painter.mask.weight[center]).toBeGreaterThan(0.5);
  });

  it('rebuilds resolution-independent paint strokes after resize', () => {
    const painter = new TerrainPainter(16);
    painter.paint('mud', 0.5, 0.5, 0.12, 1, 0.8);
    painter.resize(32);
    expect(painter.strokes).toHaveLength(1);
    expect(painter.mask.weight[16 * 32 + 16]).toBeGreaterThan(0.5);
    expect(painter.mask.material[16 * 32 + 16]).toBe(2);
  });
});
