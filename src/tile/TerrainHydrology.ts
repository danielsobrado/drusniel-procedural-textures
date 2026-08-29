import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { createFrameBudget, type FrameBudget } from '../utils/scheduling';
import type { TerrainComputeBackend, TerrainFields, TerrainSettings } from './TerrainTypes';

/** The eight D8 neighbours as flat (dx, dy) pairs; a tuple array allocated an iterator per cell. */
const NEIGHBOR_OFFSETS = new Int8Array([
  -1, -1, 0, -1, 1, -1,
  -1, 0, 1, 0,
  -1, 1, 0, 1, 1, 1
]);
const NEIGHBOR_COUNT = NEIGHBOR_OFFSETS.length / 2;
const RIVER_HISTOGRAM_BINS = 256;
const MAX_RIVER_DEPTH = 0.25;
const MAX_WETNESS_PASSES = 12;
const LINEAR_YIELD_CHECK_MASK = 0x0fff;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function periodicIndexTable(size: number): Int32Array {
  const table = new Int32Array(size + 2);
  for (let offset = 0; offset < table.length; offset += 1) {
    table[offset] = (offset - 1 + size) % size;
  }
  return table;
}

function validateTerrainInput(baseHeight: Float32Array, resolution: number): void {
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new Error('Terrain hydrology resolution must be a positive integer.');
  }
  if (baseHeight.length !== resolution * resolution) {
    throw new Error('Terrain height field dimensions do not match the requested resolution.');
  }
  for (let index = 0; index < baseHeight.length; index += 1) {
    if (!Number.isFinite(baseHeight[index])) {
      throw new Error('Terrain height field must contain only finite values.');
    }
  }
}

function validateHydrologySettings(settings: Readonly<TerrainSettings>): void {
  if (!Number.isFinite(settings.riverDensity) || settings.riverDensity < 0 || settings.riverDensity > 1) {
    throw new Error('Terrain river density must be between 0 and 1.');
  }
  if (!Number.isFinite(settings.riverDepth) || settings.riverDepth < 0 || settings.riverDepth > MAX_RIVER_DEPTH) {
    throw new Error(`Terrain river depth must be between 0 and ${MAX_RIVER_DEPTH}.`);
  }
  if (!Number.isInteger(settings.wetnessRadius) || settings.wetnessRadius < 1 || settings.wetnessRadius > MAX_WETNESS_PASSES) {
    throw new Error(`Terrain wetness radius must be an integer between 1 and ${MAX_WETNESS_PASSES}.`);
  }
}

function shouldYield(budget: FrameBudget, signal?: AbortSignal): boolean {
  signal?.throwIfAborted();
  return budget.isDue();
}

async function yieldForBudget(budget: FrameBudget, signal?: AbortSignal): Promise<void> {
  await budget.yieldIfDue();
  signal?.throwIfAborted();
}

function deriveSlope(height: Float32Array, size: number): Float32Array {
  const slope = new Float32Array(height.length);
  const wrap = periodicIndexTable(size);
  for (let y = 0; y < size; y += 1) {
    const up = (wrap[y] ?? 0) * size;
    const down = (wrap[y + 2] ?? 0) * size;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const left = wrap[x] ?? 0;
      const right = wrap[x + 2] ?? 0;
      const dx = ((height[row + right] ?? 0) - (height[row + left] ?? 0)) * 0.5;
      const dy = ((height[down + x] ?? 0) - (height[up + x] ?? 0)) * 0.5;
      slope[row + x] = clamp01(Math.hypot(dx, dy) * size * 0.42);
    }
  }
  return slope;
}

async function deriveSlopeChunked(
  height: Float32Array,
  size: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Float32Array> {
  const slope = new Float32Array(height.length);
  const wrap = periodicIndexTable(size);
  for (let y = 0; y < size; y += 1) {
    const up = (wrap[y] ?? 0) * size;
    const down = (wrap[y + 2] ?? 0) * size;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const left = wrap[x] ?? 0;
      const right = wrap[x + 2] ?? 0;
      const dx = ((height[row + right] ?? 0) - (height[row + left] ?? 0)) * 0.5;
      const dy = ((height[down + x] ?? 0) - (height[up + x] ?? 0)) * 0.5;
      slope[row + x] = clamp01(Math.hypot(dx, dy) * size * 0.42);
    }
    if (shouldYield(budget, signal)) await yieldForBudget(budget, signal);
  }
  return slope;
}

function orderKey(bitsValue: number): number {
  let bits = bitsValue;
  if (bits === 0x8000_0000) bits = 0;
  const ascending = (bits & 0x8000_0000) !== 0 ? ~bits : bits | 0x8000_0000;
  return ~ascending >>> 0;
}

function orderByDescendingHeight(height: Float32Array, count: number): Uint32Array {
  const rawBits = new Uint32Array(height.buffer, height.byteOffset, count);
  const keys = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) keys[index] = orderKey(rawBits[index] ?? 0);

  let source = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) source[index] = index;
  let scratch = new Uint32Array(count);
  const counts = new Uint32Array(256);

  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let position = 0; position < count; position += 1) {
      const bin = ((keys[source[position] ?? 0] ?? 0) >>> shift) & 0xff;
      counts[bin] = (counts[bin] ?? 0) + 1;
    }
    let total = 0;
    for (let bin = 0; bin < 256; bin += 1) {
      const size = counts[bin] ?? 0;
      counts[bin] = total;
      total += size;
    }
    for (let position = 0; position < count; position += 1) {
      const index = source[position] ?? 0;
      const bin = ((keys[index] ?? 0) >>> shift) & 0xff;
      const slot = counts[bin] ?? 0;
      scratch[slot] = index;
      counts[bin] = slot + 1;
    }
    const swap = source;
    source = scratch;
    scratch = swap;
  }
  return source;
}

async function orderByDescendingHeightChunked(
  height: Float32Array,
  count: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Uint32Array> {
  const rawBits = new Uint32Array(height.buffer, height.byteOffset, count);
  const keys = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    keys[index] = orderKey(rawBits[index] ?? 0);
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }

  let source = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    source[index] = index;
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }
  let scratch = new Uint32Array(count);
  const counts = new Uint32Array(256);

  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let position = 0; position < count; position += 1) {
      const bin = ((keys[source[position] ?? 0] ?? 0) >>> shift) & 0xff;
      counts[bin] = (counts[bin] ?? 0) + 1;
      if (
        (position & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
        shouldYield(budget, signal)
      ) {
        await yieldForBudget(budget, signal);
      }
    }
    let total = 0;
    for (let bin = 0; bin < 256; bin += 1) {
      const size = counts[bin] ?? 0;
      counts[bin] = total;
      total += size;
    }
    for (let position = 0; position < count; position += 1) {
      const index = source[position] ?? 0;
      const bin = ((keys[index] ?? 0) >>> shift) & 0xff;
      const slot = counts[bin] ?? 0;
      scratch[slot] = index;
      counts[bin] = slot + 1;
      if (
        (position & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
        shouldYield(budget, signal)
      ) {
        await yieldForBudget(budget, signal);
      }
    }
    const swap = source;
    source = scratch;
    scratch = swap;
    if (shouldYield(budget, signal)) await yieldForBudget(budget, signal);
  }
  return source;
}

function deriveFlow(height: Float32Array, size: number): Float32Array {
  const count = height.length;
  const target = new Int32Array(count);
  target.fill(-1);
  const accumulation = new Float32Array(count);
  accumulation.fill(1);
  const wrap = periodicIndexTable(size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const center = height[index] ?? 0;
      let bestHeight = center;
      let bestIndex = -1;
      for (let neighbor = 0; neighbor < NEIGHBOR_COUNT; neighbor += 1) {
        const candidateIndex = (wrap[y + 1 + (NEIGHBOR_OFFSETS[neighbor * 2 + 1] ?? 0)] ?? 0) * size +
          (wrap[x + 1 + (NEIGHBOR_OFFSETS[neighbor * 2] ?? 0)] ?? 0);
        const candidate = height[candidateIndex] ?? center;
        if (candidate < bestHeight) {
          bestHeight = candidate;
          bestIndex = candidateIndex;
        }
      }
      target[index] = bestIndex;
    }
  }

  const order = orderByDescendingHeight(height, count);
  for (let position = 0; position < count; position += 1) {
    const index = order[position] ?? 0;
    const next = target[index] ?? -1;
    if (next >= 0) accumulation[next] = (accumulation[next] ?? 1) + (accumulation[index] ?? 1);
  }

  let maximum = 1;
  for (const value of accumulation) maximum = Math.max(maximum, value);
  if (maximum <= 1) return new Float32Array(count);
  const denominator = Math.log1p(maximum);
  const flow = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    flow[index] = Math.log1p(accumulation[index] ?? 1) / denominator;
  }
  return flow;
}

async function deriveFlowChunked(
  height: Float32Array,
  size: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Float32Array> {
  const count = height.length;
  const target = new Int32Array(count);
  target.fill(-1);
  const accumulation = new Float32Array(count);
  accumulation.fill(1);
  const wrap = periodicIndexTable(size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const center = height[index] ?? 0;
      let bestHeight = center;
      let bestIndex = -1;
      for (let neighbor = 0; neighbor < NEIGHBOR_COUNT; neighbor += 1) {
        const candidateIndex = (wrap[y + 1 + (NEIGHBOR_OFFSETS[neighbor * 2 + 1] ?? 0)] ?? 0) * size +
          (wrap[x + 1 + (NEIGHBOR_OFFSETS[neighbor * 2] ?? 0)] ?? 0);
        const candidate = height[candidateIndex] ?? center;
        if (candidate < bestHeight) {
          bestHeight = candidate;
          bestIndex = candidateIndex;
        }
      }
      target[index] = bestIndex;
    }
    if (shouldYield(budget, signal)) await yieldForBudget(budget, signal);
  }

  const order = await orderByDescendingHeightChunked(height, count, budget, signal);
  for (let position = 0; position < count; position += 1) {
    const index = order[position] ?? 0;
    const next = target[index] ?? -1;
    if (next >= 0) accumulation[next] = (accumulation[next] ?? 1) + (accumulation[index] ?? 1);
    if (
      (position & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }

  let maximum = 1;
  for (let index = 0; index < count; index += 1) {
    maximum = Math.max(maximum, accumulation[index] ?? 1);
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }
  if (maximum <= 1) return new Float32Array(count);

  const denominator = Math.log1p(maximum);
  const flow = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    flow[index] = Math.log1p(accumulation[index] ?? 1) / denominator;
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }
  return flow;
}

function deriveRiverThreshold(flow: Float32Array, density: number): number | null {
  const normalizedDensity = clamp01(density);
  if (normalizedDensity <= 0) return null;

  const histogram = new Uint32Array(RIVER_HISTOGRAM_BINS);
  let positiveCount = 0;
  for (const value of flow) {
    if (value <= 0) continue;
    const bin = Math.min(
      RIVER_HISTOGRAM_BINS - 1,
      Math.floor(clamp01(value) * (RIVER_HISTOGRAM_BINS - 1))
    );
    histogram[bin] = (histogram[bin] ?? 0) + 1;
    positiveCount += 1;
  }
  if (positiveCount === 0) return null;

  const hydrology = TERRAIN_CONFIG.hydrology;
  const coverage = hydrology.minRiverCoverage +
    normalizedDensity * (hydrology.maxRiverCoverage - hydrology.minRiverCoverage);
  const targetCount = Math.min(
    positiveCount,
    Math.max(1, Math.round(flow.length * coverage))
  );
  let accumulated = 0;
  for (let bin = RIVER_HISTOGRAM_BINS - 1; bin >= 0; bin -= 1) {
    accumulated += histogram[bin] ?? 0;
    if (accumulated >= targetCount) {
      return Math.min(hydrology.riverMaxThreshold, bin / (RIVER_HISTOGRAM_BINS - 1));
    }
  }
  return hydrology.riverMaxThreshold;
}

async function deriveRiverThresholdChunked(
  flow: Float32Array,
  density: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<number | null> {
  const normalizedDensity = clamp01(density);
  if (normalizedDensity <= 0) return null;

  const histogram = new Uint32Array(RIVER_HISTOGRAM_BINS);
  let positiveCount = 0;
  for (let index = 0; index < flow.length; index += 1) {
    const value = flow[index] ?? 0;
    if (value > 0) {
      const bin = Math.min(
        RIVER_HISTOGRAM_BINS - 1,
        Math.floor(clamp01(value) * (RIVER_HISTOGRAM_BINS - 1))
      );
      histogram[bin] = (histogram[bin] ?? 0) + 1;
      positiveCount += 1;
    }
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }
  if (positiveCount === 0) return null;

  const hydrology = TERRAIN_CONFIG.hydrology;
  const coverage = hydrology.minRiverCoverage +
    normalizedDensity * (hydrology.maxRiverCoverage - hydrology.minRiverCoverage);
  const targetCount = Math.min(positiveCount, Math.max(1, Math.round(flow.length * coverage)));
  let accumulated = 0;
  for (let bin = RIVER_HISTOGRAM_BINS - 1; bin >= 0; bin -= 1) {
    accumulated += histogram[bin] ?? 0;
    if (accumulated >= targetCount) {
      return Math.min(hydrology.riverMaxThreshold, bin / (RIVER_HISTOGRAM_BINS - 1));
    }
  }
  return hydrology.riverMaxThreshold;
}

function deriveRiver(flow: Float32Array, size: number, density: number): Float32Array {
  const river = new Float32Array(flow.length);
  const threshold = deriveRiverThreshold(flow, density);
  if (threshold === null) return river;

  const range = Math.max(1e-6, 1 - threshold);
  for (let index = 0; index < flow.length; index += 1) {
    const strength = clamp01(((flow[index] ?? 0) - threshold) / range);
    river[index] = Math.sqrt(strength);
  }

  const widened = river.slice();
  const bankFalloff = TERRAIN_CONFIG.hydrology.riverBankFalloff;
  const wrap = periodicIndexTable(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      let neighborMaximum = 0;
      for (let neighbor = 0; neighbor < NEIGHBOR_COUNT; neighbor += 1) {
        const candidate = (wrap[y + 1 + (NEIGHBOR_OFFSETS[neighbor * 2 + 1] ?? 0)] ?? 0) * size +
          (wrap[x + 1 + (NEIGHBOR_OFFSETS[neighbor * 2] ?? 0)] ?? 0);
        neighborMaximum = Math.max(neighborMaximum, river[candidate] ?? 0);
      }
      widened[index] = Math.max(river[index] ?? 0, neighborMaximum * bankFalloff);
    }
  }
  return widened;
}

async function deriveRiverChunked(
  flow: Float32Array,
  size: number,
  density: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Float32Array> {
  const river = new Float32Array(flow.length);
  const threshold = await deriveRiverThresholdChunked(flow, density, budget, signal);
  if (threshold === null) return river;

  const range = Math.max(1e-6, 1 - threshold);
  for (let index = 0; index < flow.length; index += 1) {
    const strength = clamp01(((flow[index] ?? 0) - threshold) / range);
    river[index] = Math.sqrt(strength);
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }

  const widened = river.slice();
  const bankFalloff = TERRAIN_CONFIG.hydrology.riverBankFalloff;
  const wrap = periodicIndexTable(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      let neighborMaximum = 0;
      for (let neighbor = 0; neighbor < NEIGHBOR_COUNT; neighbor += 1) {
        const candidate = (wrap[y + 1 + (NEIGHBOR_OFFSETS[neighbor * 2 + 1] ?? 0)] ?? 0) * size +
          (wrap[x + 1 + (NEIGHBOR_OFFSETS[neighbor * 2] ?? 0)] ?? 0);
        neighborMaximum = Math.max(neighborMaximum, river[candidate] ?? 0);
      }
      widened[index] = Math.max(river[index] ?? 0, neighborMaximum * bankFalloff);
    }
    if (shouldYield(budget, signal)) await yieldForBudget(budget, signal);
  }
  return widened;
}

function carveRivers(height: Float32Array, river: Float32Array, depth: number): Float32Array {
  const carved = height.slice();
  for (let index = 0; index < carved.length; index += 1) {
    const channel = river[index] ?? 0;
    carved[index] = clamp01((carved[index] ?? 0) - channel * channel * depth);
  }
  return carved;
}

async function carveRiversChunked(
  height: Float32Array,
  river: Float32Array,
  depth: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Float32Array> {
  const carved = height.slice();
  for (let index = 0; index < carved.length; index += 1) {
    const channel = river[index] ?? 0;
    carved[index] = clamp01((carved[index] ?? 0) - channel * channel * depth);
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }
  return carved;
}

function deriveWetness(river: Float32Array, flow: Float32Array, size: number, radius: number): Float32Array {
  let wetness = new Float32Array(river.length);
  for (let index = 0; index < river.length; index += 1) {
    wetness[index] = clamp01((river[index] ?? 0) + (flow[index] ?? 0) * 0.12);
  }

  let next = new Float32Array(wetness.length);
  const wrap = periodicIndexTable(size);
  for (let pass = 0; pass < radius; pass += 1) {
    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      const up = (wrap[y] ?? 0) * size;
      const down = (wrap[y + 2] ?? 0) * size;
      for (let x = 0; x < size; x += 1) {
        const index = row + x;
        const center = wetness[index] ?? 0;
        const average = (
          (wetness[row + (wrap[x] ?? 0)] ?? 0) +
          (wetness[row + (wrap[x + 2] ?? 0)] ?? 0) +
          (wetness[up + x] ?? 0) +
          (wetness[down + x] ?? 0)
        ) * 0.25;
        next[index] = Math.max(center * 0.92, average * 0.88);
      }
    }
    const swap = wetness;
    wetness = next;
    next = swap;
  }
  return wetness;
}

async function deriveWetnessChunked(
  river: Float32Array,
  flow: Float32Array,
  size: number,
  radius: number,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Float32Array> {
  let wetness = new Float32Array(river.length);
  for (let index = 0; index < river.length; index += 1) {
    wetness[index] = clamp01((river[index] ?? 0) + (flow[index] ?? 0) * 0.12);
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }

  let next = new Float32Array(wetness.length);
  const wrap = periodicIndexTable(size);
  for (let pass = 0; pass < radius; pass += 1) {
    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      const up = (wrap[y] ?? 0) * size;
      const down = (wrap[y + 2] ?? 0) * size;
      for (let x = 0; x < size; x += 1) {
        const index = row + x;
        const center = wetness[index] ?? 0;
        const average = (
          (wetness[row + (wrap[x] ?? 0)] ?? 0) +
          (wetness[row + (wrap[x + 2] ?? 0)] ?? 0) +
          (wetness[up + x] ?? 0) +
          (wetness[down + x] ?? 0)
        ) * 0.25;
        next[index] = Math.max(center * 0.92, average * 0.88);
      }
      if (shouldYield(budget, signal)) await yieldForBudget(budget, signal);
    }
    const swap = wetness;
    wetness = next;
    next = swap;
  }
  return wetness;
}

function classifyMaterials(height: Float32Array, slope: Float32Array, wetness: Float32Array): Uint8Array {
  const material = new Uint8Array(height.length);
  for (let index = 0; index < height.length; index += 1) {
    const elevation = height[index] ?? 0;
    const steepness = slope[index] ?? 0;
    const moisture = wetness[index] ?? 0;
    if (elevation > 0.76 && steepness < 0.72) material[index] = 3;
    else if (steepness > 0.48 || elevation > 0.68) material[index] = 1;
    else if (moisture > 0.38 && steepness < 0.4) material[index] = 2;
    else material[index] = 0;
  }
  return material;
}

async function classifyMaterialsChunked(
  height: Float32Array,
  slope: Float32Array,
  wetness: Float32Array,
  budget: FrameBudget,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const material = new Uint8Array(height.length);
  for (let index = 0; index < height.length; index += 1) {
    const elevation = height[index] ?? 0;
    const steepness = slope[index] ?? 0;
    const moisture = wetness[index] ?? 0;
    if (elevation > 0.76 && steepness < 0.72) material[index] = 3;
    else if (steepness > 0.48 || elevation > 0.68) material[index] = 1;
    else if (moisture > 0.38 && steepness < 0.4) material[index] = 2;
    else material[index] = 0;
    if (
      (index & LINEAR_YIELD_CHECK_MASK) === LINEAR_YIELD_CHECK_MASK &&
      shouldYield(budget, signal)
    ) {
      await yieldForBudget(budget, signal);
    }
  }
  return material;
}

export function buildTerrainFields(
  baseHeight: Float32Array,
  resolution: number,
  settings: Readonly<TerrainSettings>,
  backend: TerrainComputeBackend
): TerrainFields {
  validateTerrainInput(baseHeight, resolution);
  validateHydrologySettings(settings);
  const flow = deriveFlow(baseHeight, resolution);
  const river = deriveRiver(flow, resolution, settings.riverDensity);
  const height = carveRivers(baseHeight, river, settings.riverDepth);
  const slope = deriveSlope(height, resolution);
  const wetness = deriveWetness(river, flow, resolution, settings.wetnessRadius);
  return {
    resolution,
    height,
    slope,
    flow,
    river,
    wetness,
    material: classifyMaterials(height, slope, wetness),
    backend
  };
}

export type TerrainFieldPhase =
  | 'Tracing drainage'
  | 'Carving rivers'
  | 'Deriving slope'
  | 'Spreading wetness'
  | 'Classifying materials';

export type TerrainFieldProgress = (phase: TerrainFieldPhase, fraction: number) => void;

/**
 * Same deterministic computation as buildTerrainFields, but long loops release the main thread
 * when their configured frame budget is exhausted.
 */
export function buildTerrainFieldsChunked(
  baseHeight: Float32Array,
  resolution: number,
  settings: Readonly<TerrainSettings>,
  backend: TerrainComputeBackend,
  onProgress?: TerrainFieldProgress,
  signal?: AbortSignal
): Promise<TerrainFields> {
  validateTerrainInput(baseHeight, resolution);
  validateHydrologySettings(settings);
  signal?.throwIfAborted();
  return runFieldPhases(baseHeight, resolution, settings, backend, onProgress, signal);
}

async function runFieldPhases(
  baseHeight: Float32Array,
  resolution: number,
  settings: Readonly<TerrainSettings>,
  backend: TerrainComputeBackend,
  onProgress?: TerrainFieldProgress,
  signal?: AbortSignal
): Promise<TerrainFields> {
  const budget = createFrameBudget();

  onProgress?.('Tracing drainage', 0);
  const flow = await deriveFlowChunked(baseHeight, resolution, budget, signal);

  onProgress?.('Carving rivers', 0.2);
  const river = await deriveRiverChunked(flow, resolution, settings.riverDensity, budget, signal);
  const height = await carveRiversChunked(baseHeight, river, settings.riverDepth, budget, signal);

  onProgress?.('Deriving slope', 0.45);
  const slope = await deriveSlopeChunked(height, resolution, budget, signal);

  onProgress?.('Spreading wetness', 0.65);
  const wetness = await deriveWetnessChunked(
    river,
    flow,
    resolution,
    settings.wetnessRadius,
    budget,
    signal
  );

  onProgress?.('Classifying materials', 0.85);
  const material = await classifyMaterialsChunked(height, slope, wetness, budget, signal);

  signal?.throwIfAborted();
  onProgress?.('Classifying materials', 1);
  return { resolution, height, slope, flow, river, wetness, material, backend };
}
