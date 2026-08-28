import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { TerrainComputeBackend, TerrainFields, TerrainSettings } from './TerrainTypes';

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
];
const RIVER_HISTOGRAM_BINS = 256;
const MAX_RIVER_DEPTH = 0.25;
const MAX_WETNESS_PASSES = 12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function indexOf(x: number, y: number, size: number): number {
  const wrappedX = (x + size) % size;
  const wrappedY = (y + size) % size;
  return wrappedY * size + wrappedX;
}

function validateTerrainInput(baseHeight: Float32Array, resolution: number): void {
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new Error('Terrain hydrology resolution must be a positive integer.');
  }
  if (baseHeight.length !== resolution * resolution) {
    throw new Error('Terrain height field dimensions do not match the requested resolution.');
  }
  for (const value of baseHeight) {
    if (!Number.isFinite(value)) {
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

function deriveSlope(height: Float32Array, size: number): Float32Array {
  const slope = new Float32Array(height.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((height[indexOf(x + 1, y, size)] ?? 0) - (height[indexOf(x - 1, y, size)] ?? 0)) * 0.5;
      const dy = ((height[indexOf(x, y + 1, size)] ?? 0) - (height[indexOf(x, y - 1, size)] ?? 0)) * 0.5;
      slope[y * size + x] = clamp01(Math.hypot(dx, dy) * size * 0.42);
    }
  }
  return slope;
}

function deriveFlow(height: Float32Array, size: number): Float32Array {
  const count = height.length;
  const target = new Int32Array(count);
  target.fill(-1);
  const accumulation = new Float32Array(count);
  accumulation.fill(1);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const center = height[index] ?? 0;
      let bestHeight = center;
      let bestIndex = -1;
      for (const [dx, dy] of NEIGHBORS) {
        const candidateIndex = indexOf(x + dx, y + dy, size);
        const candidate = height[candidateIndex] ?? center;
        if (candidate < bestHeight) {
          bestHeight = candidate;
          bestIndex = candidateIndex;
        }
      }
      target[index] = bestIndex;
    }
  }

  const order = Array.from({ length: count }, (_, index) => index);
  order.sort((left, right) => (height[right] ?? 0) - (height[left] ?? 0));
  for (const index of order) {
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
      return Math.min(
        hydrology.riverMaxThreshold,
        bin / (RIVER_HISTOGRAM_BINS - 1)
      );
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
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      let neighborMaximum = 0;
      for (const [dx, dy] of NEIGHBORS) {
        neighborMaximum = Math.max(
          neighborMaximum,
          river[indexOf(x + dx, y + dy, size)] ?? 0
        );
      }
      widened[index] = Math.max(river[index] ?? 0, neighborMaximum * bankFalloff);
    }
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

function deriveWetness(river: Float32Array, flow: Float32Array, size: number, radius: number): Float32Array {
  let wetness = new Float32Array(river.length);
  for (let index = 0; index < river.length; index += 1) {
    wetness[index] = clamp01((river[index] ?? 0) + (flow[index] ?? 0) * 0.12);
  }

  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Float32Array(wetness.length);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = y * size + x;
        const center = wetness[index] ?? 0;
        const average = (
          (wetness[indexOf(x - 1, y, size)] ?? 0) +
          (wetness[indexOf(x + 1, y, size)] ?? 0) +
          (wetness[indexOf(x, y - 1, size)] ?? 0) +
          (wetness[indexOf(x, y + 1, size)] ?? 0)
        ) * 0.25;
        next[index] = Math.max(center * 0.92, average * 0.88);
      }
    }
    wetness = next;
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

/** Phase labels in the order they run, for progress reporting. */
export type TerrainFieldPhase =
  | 'Tracing drainage'
  | 'Carving rivers'
  | 'Deriving slope'
  | 'Spreading wetness'
  | 'Classifying materials';

export type TerrainFieldProgress = (phase: TerrainFieldPhase, fraction: number) => void;

/**
 * Same computation as buildTerrainFields, but yields to the browser between phases so
 * "Generate" cannot lock the main thread. deriveFlow alone sorts every cell
 * (resolution squared), so the synchronous form blocked for the whole run.
 *
 * Validation still throws synchronously, matching buildTerrainFields.
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

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

async function runFieldPhases(
  baseHeight: Float32Array,
  resolution: number,
  settings: Readonly<TerrainSettings>,
  backend: TerrainComputeBackend,
  onProgress?: TerrainFieldProgress,
  signal?: AbortSignal
): Promise<TerrainFields> {
  onProgress?.('Tracing drainage', 0);
  await yieldToBrowser();
  signal?.throwIfAborted();
  const flow = deriveFlow(baseHeight, resolution);

  onProgress?.('Carving rivers', 0.2);
  await yieldToBrowser();
  signal?.throwIfAborted();
  const river = deriveRiver(flow, resolution, settings.riverDensity);
  const height = carveRivers(baseHeight, river, settings.riverDepth);

  onProgress?.('Deriving slope', 0.45);
  await yieldToBrowser();
  signal?.throwIfAborted();
  const slope = deriveSlope(height, resolution);

  onProgress?.('Spreading wetness', 0.65);
  await yieldToBrowser();
  signal?.throwIfAborted();
  const wetness = deriveWetness(river, flow, resolution, settings.wetnessRadius);

  onProgress?.('Classifying materials', 0.85);
  await yieldToBrowser();
  signal?.throwIfAborted();
  const material = classifyMaterials(height, slope, wetness);

  onProgress?.('Classifying materials', 1);
  return { resolution, height, slope, flow, river, wetness, material, backend };
}
