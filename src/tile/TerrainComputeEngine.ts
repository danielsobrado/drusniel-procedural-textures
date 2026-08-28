import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { TerrainComputeBackend, TerrainSettings } from './TerrainTypes';

const TAU = Math.PI * 2;
const UINT32_RANGE = 0x1_0000_0000;
const MIN_SIGNED_SEED = -0x8000_0000;
const MAX_UNSIGNED_SEED = 0xffff_ffff;
const MAX_MOUNTAIN_HEIGHT = 1.5;
const MIN_RIDGE_SHARPNESS = 0.5;
const MAX_RIDGE_SHARPNESS = 8;
const HASH_SALT_MULTIPLIER = 0x9e3779b9;
const HASH_MULTIPLIER_A = 0x7feb352d;
const HASH_MULTIPLIER_B = 0x846ca68b;
const GPU_BUFFER_USAGE_MAP_READ = 0x0001;
const GPU_BUFFER_USAGE_COPY_SRC = 0x0004;
const GPU_BUFFER_USAGE_COPY_DST = 0x0008;
const GPU_BUFFER_USAGE_UNIFORM = 0x0040;
const GPU_BUFFER_USAGE_STORAGE = 0x0080;
const GPU_MAP_MODE_READ = 0x0001;

interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}

interface GpuComputePassLike {
  setPipeline(pipeline: GpuPipelineLike): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(x: number, y: number): void;
  end(): void;
}

interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    target: GpuBufferLike,
    targetOffset: number,
    size: number
  ): void;
  finish(): unknown;
}

interface GpuDeviceLike {
  createShaderModule(descriptor: { code: string; label?: string }): unknown;
  createComputePipelineAsync(descriptor: unknown): Promise<GpuPipelineLike>;
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
  queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView): void;
    submit(commands: unknown[]): void;
  };
}

export interface TerrainHeightResult {
  height: Float32Array;
  backend: TerrainComputeBackend;
}

const TERRAIN_WGSL = /* wgsl */ `
struct Params {
  resolution: u32,
  seed: u32,
  padding0: u32,
  padding1: u32,
  coverage: f32,
  mountainHeight: f32,
  ridgeSharpness: f32,
  detail: f32,
}

@group(0) @binding(0) var<storage, read_write> heightField: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;

const TAU: f32 = 6.283185307179586;
const UINT32_RANGE: f32 = 4294967296.0;

fn hashU32(value: u32) -> u32 {
  var result = value;
  result = result ^ (result >> 16u);
  result = result * 0x7feb352du;
  result = result ^ (result >> 15u);
  result = result * 0x846ca68bu;
  result = result ^ (result >> 16u);
  return result;
}

fn hash01(salt: u32) -> f32 {
  let mixed = params.seed ^ (salt * 0x9e3779b9u);
  return f32(hashU32(mixed)) / UINT32_RANGE;
}

fn phase(salt: u32) -> f32 {
  return hash01(salt) * TAU;
}

fn wrappedDelta(value: f32, center: f32) -> f32 {
  let raw = value - center;
  return raw - floor(raw + 0.5);
}

fn mountainCluster(
  uv: vec2f,
  center: vec2f,
  angle: f32,
  halfLength: f32,
  halfWidth: f32
) -> f32 {
  let delta = vec2f(
    wrappedDelta(uv.x, center.x),
    wrappedDelta(uv.y, center.y)
  );
  let cosine = cos(angle);
  let sine = sin(angle);
  let along = delta.x * cosine + delta.y * sine;
  let across = -delta.x * sine + delta.y * cosine;
  let ellipse = along * along / (halfLength * halfLength) +
    across * across / (halfWidth * halfWidth);
  return exp(-ellipse * 1.7);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.resolution || id.y >= params.resolution) { return; }

  let uv = vec2f(id.xy) / f32(params.resolution);
  let p = uv * TAU;
  let coverage = clamp(params.coverage, 0.0, 1.0);
  let rangeLength = 0.16 + coverage * 0.16;
  let rangeWidth = 0.045 + coverage * 0.075;

  let clusterA = mountainCluster(
    uv,
    vec2f(hash01(21u), hash01(22u)),
    phase(23u),
    rangeLength,
    rangeWidth
  );
  let clusterB = mountainCluster(
    uv,
    vec2f(hash01(31u), hash01(32u)),
    phase(33u),
    rangeLength * 0.86,
    rangeWidth * 1.15
  );
  let clusterC = mountainCluster(
    uv,
    vec2f(hash01(41u), hash01(42u)),
    phase(43u),
    rangeLength * 0.72,
    rangeWidth * 0.9
  );
  let mountain = max(clusterA, max(clusterB * 0.92, clusterC * 0.82));

  let broad = clamp(
    0.5 +
    0.18 * sin(p.x + phase(7u)) * cos(p.y + phase(8u)) +
    0.11 * sin(p.x * 2.0 + p.y + phase(9u)) +
    0.07 * cos(p.x - p.y * 2.0 + phase(10u)),
    0.0,
    1.0
  );
  let peak = pow(
    clamp(mountain, 0.0, 1.0),
    0.78 + clamp(params.ridgeSharpness, 0.5, 8.0) * 0.13
  );
  let ridgeDetail = 0.5 + 0.5 *
    sin(p.x * 3.0 + p.y * 2.0 + phase(11u)) *
    sin(p.y * 2.0 - p.x + phase(12u));
  let micro = clamp(
    0.5 +
    0.25 * sin(p.x * 5.0 + p.y * 3.0 + phase(13u)) +
    0.25 * cos(p.x * 4.0 - p.y * 5.0 + phase(14u)),
    0.0,
    1.0
  );
  let mountainLift = peak * params.mountainHeight * (0.40 + ridgeDetail * 0.12);
  let microLift = (micro - 0.5) * params.detail * 0.07 * (0.35 + mountain * 0.65);
  let value = 0.13 + broad * 0.34 + mountainLift + microLift;
  heightField[id.y * params.resolution + id.x] = clamp(value, 0.0, 1.0);
}
`;

function hashU32(value: number): number {
  let result = value >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  result = Math.imul(result, HASH_MULTIPLIER_A) >>> 0;
  result = (result ^ (result >>> 15)) >>> 0;
  result = Math.imul(result, HASH_MULTIPLIER_B) >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  return result;
}

function hash01(seed: number, salt: number): number {
  const mixed = (seed >>> 0) ^ (Math.imul(salt >>> 0, HASH_SALT_MULTIPLIER) >>> 0);
  return Math.fround(hashU32(mixed) / UINT32_RANGE);
}

function phase(seed: number, salt: number): number {
  return hash01(seed, salt) * TAU;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function wrappedDelta(value: number, center: number): number {
  const raw = value - center;
  return raw - Math.floor(raw + 0.5);
}

function mountainCluster(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  angle: number,
  halfLength: number,
  halfWidth: number
): number {
  const deltaX = wrappedDelta(x, centerX);
  const deltaY = wrappedDelta(y, centerY);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const along = deltaX * cosine + deltaY * sine;
  const across = -deltaX * sine + deltaY * cosine;
  const ellipse = along * along / (halfLength * halfLength) +
    across * across / (halfWidth * halfWidth);
  return Math.exp(-ellipse * 1.7);
}

function periodicHeight(x: number, y: number, settings: Readonly<TerrainSettings>): number {
  const pX = x * TAU;
  const pY = y * TAU;
  const coverage = clamp01(settings.mountainCoverage);
  const rangeLength = 0.16 + coverage * 0.16;
  const rangeWidth = 0.045 + coverage * 0.075;
  const clusterA = mountainCluster(
    x,
    y,
    hash01(settings.seed, 21),
    hash01(settings.seed, 22),
    phase(settings.seed, 23),
    rangeLength,
    rangeWidth
  );
  const clusterB = mountainCluster(
    x,
    y,
    hash01(settings.seed, 31),
    hash01(settings.seed, 32),
    phase(settings.seed, 33),
    rangeLength * 0.86,
    rangeWidth * 1.15
  );
  const clusterC = mountainCluster(
    x,
    y,
    hash01(settings.seed, 41),
    hash01(settings.seed, 42),
    phase(settings.seed, 43),
    rangeLength * 0.72,
    rangeWidth * 0.9
  );
  const mountain = Math.max(clusterA, clusterB * 0.92, clusterC * 0.82);
  const broad = clamp01(
    0.5 +
    0.18 * Math.sin(pX + phase(settings.seed, 7)) * Math.cos(pY + phase(settings.seed, 8)) +
    0.11 * Math.sin(pX * 2 + pY + phase(settings.seed, 9)) +
    0.07 * Math.cos(pX - pY * 2 + phase(settings.seed, 10))
  );
  const peak = Math.pow(
    clamp01(mountain),
    0.78 + Math.max(0.5, Math.min(8, settings.ridgeSharpness)) * 0.13
  );
  const ridgeDetail = 0.5 + 0.5 *
    Math.sin(pX * 3 + pY * 2 + phase(settings.seed, 11)) *
    Math.sin(pY * 2 - pX + phase(settings.seed, 12));
  const micro = clamp01(
    0.5 +
    0.25 * Math.sin(pX * 5 + pY * 3 + phase(settings.seed, 13)) +
    0.25 * Math.cos(pX * 4 - pY * 5 + phase(settings.seed, 14))
  );
  const mountainLift = peak * settings.mountainHeight * (0.4 + ridgeDetail * 0.12);
  const microLift = (micro - 0.5) * settings.detail * 0.07 * (0.35 + mountain * 0.65);
  return clamp01(0.13 + broad * 0.34 + mountainLift + microLift);
}

function validateScalar(value: number, label: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
}

function validateTerrainSettings(settings: Readonly<TerrainSettings>): void {
  if (!Number.isInteger(settings.seed) || settings.seed < MIN_SIGNED_SEED || settings.seed > MAX_UNSIGNED_SEED) {
    throw new Error(`Terrain seed must be an integer between ${MIN_SIGNED_SEED} and ${MAX_UNSIGNED_SEED}.`);
  }
  validateScalar(settings.mountainCoverage, 'Terrain mountain coverage', 0, 1);
  validateScalar(settings.mountainHeight, 'Terrain mountain height', 0, MAX_MOUNTAIN_HEIGHT);
  validateScalar(
    settings.ridgeSharpness,
    'Terrain ridge sharpness',
    MIN_RIDGE_SHARPNESS,
    MAX_RIDGE_SHARPNESS
  );
  validateScalar(settings.detail, 'Terrain detail', 0, 1);
}

function waitForTask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export class TerrainComputeEngine {
  private device: GpuDeviceLike | null = null;
  private pipeline: GpuPipelineLike | null = null;
  private initializationPromise: Promise<boolean> | null = null;

  public async generate(
    settings: Readonly<TerrainSettings>,
    resolution: number,
    signal?: AbortSignal
  ): Promise<TerrainHeightResult> {
    this.validateResolution(resolution);
    validateTerrainSettings(settings);
    signal?.throwIfAborted();
    if (await this.initialize()) {
      signal?.throwIfAborted();
      try {
        return { height: await this.generateGpu(settings, resolution, signal), backend: 'webgpu' };
      } catch (error) {
        signal?.throwIfAborted();
        console.warn('Terrain WebGPU generation failed; using deterministic CPU fallback.', error);
        this.device = null;
        this.pipeline = null;
        this.initializationPromise = null;
      }
    }
    signal?.throwIfAborted();
    return { height: await this.generateCpu(settings, resolution, signal), backend: 'cpu' };
  }

  private async initialize(): Promise<boolean> {
    if (this.device !== null && this.pipeline !== null) return true;
    this.initializationPromise ??= this.initializeGpu();
    const initialized = await this.initializationPromise;
    if (!initialized) this.initializationPromise = null;
    return initialized;
  }

  private async initializeGpu(): Promise<boolean> {
    if (typeof globalThis.navigator === 'undefined') return false;
    const navigatorWithGpu = globalThis.navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<GpuDeviceLike> } | null> };
    };
    if (navigatorWithGpu.gpu === undefined) return false;
    try {
      const adapter = await navigatorWithGpu.gpu.requestAdapter();
      if (adapter === null) return false;
      this.device = await adapter.requestDevice();
      const module = this.device.createShaderModule({ code: TERRAIN_WGSL, label: 'PTL terrain generator' });
      this.pipeline = await this.device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
      });
      return true;
    } catch (error) {
      console.warn('Terrain WebGPU initialization failed.', error);
      this.device = null;
      this.pipeline = null;
      return false;
    }
  }

  private async generateGpu(
    settings: Readonly<TerrainSettings>,
    resolution: number,
    signal?: AbortSignal
  ): Promise<Float32Array> {
    signal?.throwIfAborted();
    const device = this.device;
    const pipeline = this.pipeline;
    if (device === null || pipeline === null) throw new Error('Terrain WebGPU pipeline is unavailable.');

    const byteLength = resolution * resolution * Float32Array.BYTES_PER_ELEMENT;
    const fieldBuffer = device.createBuffer({
      size: byteLength,
      usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_SRC
    });
    const readBuffer = device.createBuffer({
      size: byteLength,
      usage: GPU_BUFFER_USAGE_MAP_READ | GPU_BUFFER_USAGE_COPY_DST
    });
    const paramsBuffer = device.createBuffer({
      size: 32,
      usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST
    });

    try {
      const params = new ArrayBuffer(32);
      const view = new DataView(params);
      view.setUint32(0, resolution, true);
      view.setUint32(4, settings.seed >>> 0, true);
      view.setUint32(8, 0, true);
      view.setUint32(12, 0, true);
      view.setFloat32(16, settings.mountainCoverage, true);
      view.setFloat32(20, settings.mountainHeight, true);
      view.setFloat32(24, settings.ridgeSharpness, true);
      view.setFloat32(28, settings.detail, true);
      device.queue.writeBuffer(paramsBuffer, 0, new Uint8Array(params));

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: fieldBuffer } },
          { binding: 1, resource: { buffer: paramsBuffer } }
        ]
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
      pass.end();
      encoder.copyBufferToBuffer(fieldBuffer, 0, readBuffer, 0, byteLength);
      device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPU_MAP_MODE_READ);
      signal?.throwIfAborted();
      const values = new Float32Array(readBuffer.getMappedRange()).slice();
      readBuffer.unmap();
      return values;
    } finally {
      fieldBuffer.destroy();
      readBuffer.destroy();
      paramsBuffer.destroy();
    }
  }

  private async generateCpu(
    settings: Readonly<TerrainSettings>,
    resolution: number,
    signal?: AbortSignal
  ): Promise<Float32Array> {
    const height = new Float32Array(resolution * resolution);
    const yieldRows = TERRAIN_CONFIG.compute.cpuYieldRows;
    for (let y = 0; y < resolution; y += 1) {
      signal?.throwIfAborted();
      for (let x = 0; x < resolution; x += 1) {
        height[y * resolution + x] = periodicHeight(x / resolution, y / resolution, settings);
      }
      if ((y + 1) % yieldRows === 0 && y + 1 < resolution) {
        await waitForTask();
        signal?.throwIfAborted();
      }
    }
    return height;
  }

  private validateResolution(resolution: number): void {
    if (!Number.isInteger(resolution) || resolution < 32 || resolution > 1024 || (resolution & (resolution - 1)) !== 0) {
      throw new Error('Terrain resolution must be a power of two between 32 and 1024.');
    }
  }
}
