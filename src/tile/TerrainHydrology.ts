import type { TerrainComputeBackend, TerrainFields, TerrainSettings } from './TerrainTypes';

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function indexOf(x: number, y: number, size: number): number {
  const wrappedX = (x + size) % size;
  const wrappedY = (y + size) % size;
  return wrappedY * size + wrappedX;
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

function deriveRiver(flow: Float32Array, density: number): Float32Array {
  const normalizedDensity = clamp01(density);
  const river = new Float32Array(flow.length);
  if (normalizedDensity <= 0) return river;
  const threshold = 0.9 - normalizedDensity * 0.32;
  const transition = 0.1 + normalizedDensity * 0.08;
  for (let index = 0; index < flow.length; index += 1) {
    river[index] = clamp01(((flow[index] ?? 0) - threshold) / transition);
  }
  return river;
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

  const passes = Math.max(1, Math.min(12, radius));
  for (let pass = 0; pass < passes; pass += 1) {
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
  if (baseHeight.length !== resolution * resolution) {
    throw new Error('Terrain height field dimensions do not match the requested resolution.');
  }
  const flow = deriveFlow(baseHeight, resolution);
  const river = deriveRiver(flow, settings.riverDensity);
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
