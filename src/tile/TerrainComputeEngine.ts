import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { TerrainComputeBackend, TerrainSettings } from './TerrainTypes';

const TAU = Math.PI * 2;
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
  ridgeFrequency: u32,
  padding: u32,
  coverage: f32,
  mountainHeight: f32,
  ridgeSharpness: f32,
  detail: f32,
}

@group(0) @binding(0) var<storage, read_write> heightField: array<f32>;
@group(0) @binding(1) var<uniform> params: Params;

const TAU: f32 = 6.283185307179586;

fn phase(salt: f32) -> f32 {
  return fract(sin(f32(params.seed) * 0.000173 + salt * 12.9898) * 43758.5453) * TAU;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.resolution || id.y >= params.resolution) { return; }

  let uv = vec2f(id.xy) / f32(params.resolution);
  let p = uv * TAU;
  let warp = vec2f(
    sin(p.y * 2.0 + phase(1.0)) * 0.34 + sin(p.x * 3.0 + phase(2.0)) * 0.13,
    sin(p.x * 2.0 + phase(3.0)) * 0.31 + sin(p.y * 4.0 + phase(4.0)) * 0.11
  );
  let q = p + warp;
  let frequency = f32(params.ridgeFrequency);
  let ridgeA = pow(max(0.0, 1.0 - abs(sin(q.x * frequency + sin(q.y * 2.0) * 1.3 + phase(5.0)))), params.ridgeSharpness);
  let ridgeB = pow(max(0.0, 1.0 - abs(sin(q.y * (frequency - 1.0) + sin(q.x * 3.0) * 0.9 + phase(6.0)))), params.ridgeSharpness + 0.55);
  let broad = 0.5 + 0.22 * sin(p.x + phase(7.0)) + 0.18 * cos(p.y * 2.0 + phase(8.0)) + 0.1 * sin((p.x + p.y) * 2.0 + phase(9.0));
  let gateLow = 0.58 - params.coverage * 0.34;
  let gateHigh = 0.88 - params.coverage * 0.18;
  let ridge = max(ridgeA, ridgeB * 0.78);
  let gate = smoothstep(gateLow, gateHigh, ridge + broad * 0.28);
  let micro = 0.5 + 0.28 * sin(p.x * 11.0 + p.y * 7.0 + phase(10.0)) + 0.22 * cos(p.x * 8.0 - p.y * 13.0 + phase(11.0));
  let value = 0.16 + broad * 0.2 + ridge * gate * params.mountainHeight * 0.72 + (micro - 0.5) * params.detail * 0.13;
  heightField[id.y * params.resolution + id.x] = clamp(value, 0.0, 1.0);
}
`;

function phase(seed: number, salt: number): number {
  const value = Math.sin(seed * 0.000173 + salt * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * TAU;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function periodicHeight(x: number, y: number, settings: Readonly<TerrainSettings>): number {
  const pX = x * TAU;
  const pY = y * TAU;
  const warpX = Math.sin(pY * 2 + phase(settings.seed, 1)) * 0.34 + Math.sin(pX * 3 + phase(settings.seed, 2)) * 0.13;
  const warpY = Math.sin(pX * 2 + phase(settings.seed, 3)) * 0.31 + Math.sin(pY * 4 + phase(settings.seed, 4)) * 0.11;
  const qX = pX + warpX;
  const qY = pY + warpY;
  const frequency = Math.max(2, Math.min(6, Math.round(2 + settings.mountainCoverage * 4)));
  const ridgeA = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(qX * frequency + Math.sin(qY * 2) * 1.3 + phase(settings.seed, 5)))), settings.ridgeSharpness);
  const ridgeB = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(qY * (frequency - 1) + Math.sin(qX * 3) * 0.9 + phase(settings.seed, 6)))), settings.ridgeSharpness + 0.55);
  const broad = 0.5 + 0.22 * Math.sin(pX + phase(settings.seed, 7)) + 0.18 * Math.cos(pY * 2 + phase(settings.seed, 8)) + 0.1 * Math.sin((pX + pY) * 2 + phase(settings.seed, 9));
  const ridge = Math.max(ridgeA, ridgeB * 0.78);
  const gate = smoothstep(0.58 - settings.mountainCoverage * 0.34, 0.88 - settings.mountainCoverage * 0.18, ridge + broad * 0.28);
  const micro = 0.5 + 0.28 * Math.sin(pX * 11 + pY * 7 + phase(settings.seed, 10)) + 0.22 * Math.cos(pX * 8 - pY * 13 + phase(settings.seed, 11));
  return clamp01(0.16 + broad * 0.2 + ridge * gate * settings.mountainHeight * 0.72 + (micro - 0.5) * settings.detail * 0.13);
}

function waitForTask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export class TerrainComputeEngine {
  private device: GpuDeviceLike | null = null;
  private pipeline: GpuPipelineLike | null = null;
  private initializationPromise: Promise<boolean> | null = null;

  public async generate(settings: Readonly<TerrainSettings>, resolution: number): Promise<TerrainHeightResult> {
    this.validateResolution(resolution);
    if (await this.initialize()) {
      try {
        return { height: await this.generateGpu(settings, resolution), backend: 'webgpu' };
      } catch (error) {
        console.warn('Terrain WebGPU generation failed; using deterministic CPU fallback.', error);
        this.device = null;
        this.pipeline = null;
        this.initializationPromise = null;
      }
    }
    return { height: await this.generateCpu(settings, resolution), backend: 'cpu' };
  }

  private async initialize(): Promise<boolean> {
    if (this.device !== null && this.pipeline !== null) return true;
    this.initializationPromise ??= this.initializeGpu();
    return this.initializationPromise;
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

  private async generateGpu(settings: Readonly<TerrainSettings>, resolution: number): Promise<Float32Array> {
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
      view.setUint32(8, Math.max(2, Math.min(6, Math.round(2 + settings.mountainCoverage * 4))), true);
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
      const values = new Float32Array(readBuffer.getMappedRange()).slice();
      readBuffer.unmap();
      return values;
    } finally {
      fieldBuffer.destroy();
      readBuffer.destroy();
      paramsBuffer.destroy();
    }
  }

  private async generateCpu(settings: Readonly<TerrainSettings>, resolution: number): Promise<Float32Array> {
    const height = new Float32Array(resolution * resolution);
    const yieldRows = TERRAIN_CONFIG.compute.cpuYieldRows;
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        height[y * resolution + x] = periodicHeight(x / resolution, y / resolution, settings);
      }
      if ((y + 1) % yieldRows === 0 && y + 1 < resolution) await waitForTask();
    }
    return height;
  }

  private validateResolution(resolution: number): void {
    if (!Number.isInteger(resolution) || resolution < 32 || resolution > 1024 || (resolution & (resolution - 1)) !== 0) {
      throw new Error('Terrain resolution must be a power of two between 32 and 1024.');
    }
  }
}
