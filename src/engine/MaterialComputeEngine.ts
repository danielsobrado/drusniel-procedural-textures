export type ComputeBackend = 'webgpu' | 'webgl-fallback';
export type SimulationKind = 'reaction-diffusion' | 'thermal-erosion';

export interface ComputeStatus {
  backend: ComputeBackend;
  available: boolean;
  label: string;
}

export interface ReactionDiffusionParameters {
  feed: number;
  kill: number;
  diffusionA: number;
  diffusionB: number;
}

export interface SimulationRequest {
  kind: SimulationKind;
  size: number;
  iterations: number;
  seed: number;
  reactionDiffusion?: Readonly<ReactionDiffusionParameters>;
  erosionRate?: number;
}

export interface SimulationField {
  width: number;
  height: number;
  values: Float32Array;
  min: number;
  max: number;
  histogram: Uint32Array;
}

const CPU_WORK_BUDGET = 32 * 1024 * 1024;
// One simulation iteration touches size*size cells, so at the default 128 grid the old
// interval of 8 meant ~131k tight-loop iterations between yields - long enough to drop
// frames. Yielding every iteration keeps the main thread responsive; the simulation is
// already off the critical path.
const CPU_YIELD_INTERVAL = 1;
const GPU_DISPATCH_BATCH = 128;
const SIMULATION_KINDS = new Set<SimulationKind>(['reaction-diffusion', 'thermal-erosion']);
const DEFAULT_REACTION_DIFFUSION: Readonly<ReactionDiffusionParameters> = {
  feed: 0.055,
  kill: 0.062,
  diffusionA: 0.18,
  diffusionB: 0.09
};
const DEFAULT_EROSION_RATE = 0.22;

export const REACTION_DIFFUSION_WGSL = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  feed: f32,
  kill: f32,
  diffusionA: f32,
  diffusionB: f32,
}
@group(0) @binding(0) var<storage, read> source: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> nextState: array<vec2f>;
@group(0) @binding(2) var<uniform> params: Params;
fn at(x: u32, y: u32) -> vec2f {
  return source[(y % params.height) * params.width + (x % params.width)];
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let index = id.y * params.width + id.x;
  let state = source[index];
  let left = (id.x + params.width - 1u) % params.width;
  let down = (id.y + params.height - 1u) % params.height;
  let lap = at(left, id.y) + at(id.x + 1u, id.y) + at(id.x, down) + at(id.x, id.y + 1u) - state * 4.0;
  let reaction = state.x * state.y * state.y;
  let delta = vec2f(params.diffusionA, params.diffusionB) * lap +
    vec2f(-reaction + params.feed * (1.0 - state.x), reaction - (params.feed + params.kill) * state.y);
  nextState[index] = clamp(state + delta, vec2f(0.0), vec2f(1.0));
}`;

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
  setPipeline(value: GpuPipelineLike): void;
  setBindGroup(index: number, value: unknown): void;
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
  createShaderModule(descriptor: { code: string; label: string }): unknown;
  createComputePipelineAsync(descriptor: unknown): Promise<GpuPipelineLike>;
  createBuffer(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBufferLike;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
  queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView): void;
    submit(commands: unknown[]): void;
  };
}

function hash(value: number): number {
  let state = value | 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  return ((state ^ (state >>> 16)) >>> 0) / 4294967295;
}

function analyze(values: Float32Array): Pick<SimulationField, 'min' | 'max' | 'histogram'> {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const histogram = new Uint32Array(64);
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    const index = Math.max(0, Math.min(63, Math.floor(value * 64)));
    histogram[index] = (histogram[index] ?? 0) + 1;
  }
  return { min, max, histogram };
}

function finite(value: number, label: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

/**
 * setTimeout(0) is clamped to 4ms once nesting passes five levels, which serialised
 * badly across thousands of yields. A message-channel task has no such clamp.
 */
const yieldChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;

function waitForTask(): Promise<void> {
  if (yieldChannel === null) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const done = (): void => {
      yieldChannel.port1.removeEventListener('message', done);
      resolve();
    };
    yieldChannel.port1.addEventListener('message', done);
    yieldChannel.port1.start();
    yieldChannel.port2.postMessage(null);
  });
}

export class MaterialComputeEngine {
  private readonly pipelineCache = new Map<string, GpuPipelineLike>();
  private device: GpuDeviceLike | null = null;
  private initializationPromise: Promise<Readonly<ComputeStatus>> | null = null;
  private statusValue: ComputeStatus = {
    backend: 'webgl-fallback',
    available: false,
    label: 'CPU simulation fallback'
  };

  public get status(): Readonly<ComputeStatus> {
    return this.statusValue;
  }

  public get cachedPipelineCount(): number {
    return this.pipelineCache.size;
  }

  public async initialize(): Promise<Readonly<ComputeStatus>> {
    if (this.device !== null) return this.status;
    this.initializationPromise ??= this.initializeGpu();
    const status = await this.initializationPromise;
    if (!status.available) this.initializationPromise = null;
    return status;
  }

  public async simulate(request: Readonly<SimulationRequest>): Promise<SimulationField> {
    this.validateRequest(request);
    const values = request.kind === 'reaction-diffusion'
      ? await this.runReactionDiffusion(request)
      : await this.runThermalErosion(request);
    return { width: request.size, height: request.size, values, ...analyze(values) };
  }

  private async initializeGpu(): Promise<Readonly<ComputeStatus>> {
    if (typeof globalThis.navigator === 'undefined') return this.status;
    const navigatorWithGpu = globalThis.navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<unknown> };
    };
    const gpu = navigatorWithGpu.gpu;
    if (gpu === undefined) return this.status;

    try {
      const adapter = await gpu.requestAdapter() as {
        requestDevice?: () => Promise<GpuDeviceLike>;
      } | null;
      if (adapter?.requestDevice === undefined) return this.status;

      const device = await adapter.requestDevice();
      const module = device.createShaderModule({
        code: REACTION_DIFFUSION_WGSL,
        label: 'PTL reaction diffusion'
      });
      const pipeline = await device.createComputePipelineAsync({
        label: 'PTL reaction diffusion pipeline',
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
      });
      this.device = device;
      this.pipelineCache.set('reaction-diffusion', pipeline);
      this.statusValue = { backend: 'webgpu', available: true, label: 'WebGPU compute' };
    } catch {
      this.device = null;
      this.pipelineCache.clear();
      this.statusValue = {
        backend: 'webgl-fallback',
        available: false,
        label: 'CPU simulation fallback'
      };
    }
    return this.status;
  }

  private validateRequest(request: Readonly<SimulationRequest>): void {
    if (!SIMULATION_KINDS.has(request.kind)) {
      throw new Error(`Unsupported simulation kind: ${String(request.kind)}.`);
    }
    if (!Number.isInteger(request.size) || request.size < 8 || request.size > 1024) {
      throw new Error('Simulation size must be an integer between 8 and 1024.');
    }
    if (!Number.isInteger(request.iterations) || request.iterations < 1 || request.iterations > 4096) {
      throw new Error('Simulation iterations must be an integer between 1 and 4096.');
    }
    if (!Number.isSafeInteger(request.seed)) {
      throw new Error('Simulation seed must be a safe integer.');
    }
    const reaction = request.reactionDiffusion ?? DEFAULT_REACTION_DIFFUSION;
    finite(reaction.feed, 'Reaction diffusion feed', 0, 0.2);
    finite(reaction.kill, 'Reaction diffusion kill', 0, 0.2);
    finite(reaction.diffusionA, 'Reaction diffusion A', 0, 1);
    finite(reaction.diffusionB, 'Reaction diffusion B', 0, 1);
    finite(request.erosionRate ?? DEFAULT_EROSION_RATE, 'Thermal erosion rate', 0, 1);
  }

  private assertCpuBudget(request: Readonly<SimulationRequest>): void {
    const work = request.size * request.size * request.iterations;
    if (work > CPU_WORK_BUDGET) {
      throw new Error(
        `CPU simulation fallback work budget exceeded (${work.toLocaleString()} > ${CPU_WORK_BUDGET.toLocaleString()}). ` +
        'Reduce resolution or iterations, or use WebGPU.'
      );
    }
  }

  private async runReactionDiffusion(request: Readonly<SimulationRequest>): Promise<Float32Array> {
    if (this.device !== null) {
      try {
        return await this.reactionDiffusionGpu(request);
      } catch {
        this.device = null;
        this.initializationPromise = null;
        this.pipelineCache.clear();
        this.statusValue = {
          backend: 'webgl-fallback',
          available: false,
          label: 'CPU simulation fallback'
        };
      }
    }
    this.assertCpuBudget(request);
    return this.reactionDiffusionCpu(request);
  }

  private async runThermalErosion(request: Readonly<SimulationRequest>): Promise<Float32Array> {
    this.assertCpuBudget(request);
    return this.thermalErosionCpu(request);
  }

  private async reactionDiffusionGpu(request: Readonly<SimulationRequest>): Promise<Float32Array> {
    const device = this.device;
    const pipeline = this.pipelineCache.get('reaction-diffusion');
    if (device === null || pipeline === undefined) {
      this.assertCpuBudget(request);
      return this.reactionDiffusionCpu(request);
    }

    const itemCount = request.size * request.size;
    const state = new Float32Array(itemCount * 2);
    for (let index = 0; index < itemCount; index += 1) {
      state[index * 2] = 1;
      state[index * 2 + 1] = hash(index + request.seed * 7919) > 0.94 ? 1 : 0;
    }

    const STORAGE = 0x0080;
    const COPY_SRC = 0x0004;
    const COPY_DST = 0x0008;
    const UNIFORM = 0x0040;
    const MAP_READ = 0x0001;
    const bytes = state.byteLength;
    let first: GpuBufferLike | null = null;
    let second: GpuBufferLike | null = null;
    let params: GpuBufferLike | null = null;
    let readback: GpuBufferLike | null = null;
    let readbackMapped = false;

    try {
      const firstBuffer = first = device.createBuffer({ size: bytes, usage: STORAGE | COPY_SRC | COPY_DST });
      const secondBuffer = second = device.createBuffer({ size: bytes, usage: STORAGE | COPY_SRC | COPY_DST });
      const paramsBuffer = params = device.createBuffer({ size: 32, usage: UNIFORM | COPY_DST });
      const readbackBuffer = readback = device.createBuffer({ size: bytes, usage: COPY_DST | MAP_READ });
      const parameterBytes = new ArrayBuffer(32);
      const parameterView = new DataView(parameterBytes);
      const reaction = request.reactionDiffusion ?? DEFAULT_REACTION_DIFFUSION;
      parameterView.setUint32(0, request.size, true);
      parameterView.setUint32(4, request.size, true);
      parameterView.setFloat32(8, reaction.feed, true);
      parameterView.setFloat32(12, reaction.kill, true);
      parameterView.setFloat32(16, reaction.diffusionA, true);
      parameterView.setFloat32(20, reaction.diffusionB, true);
      device.queue.writeBuffer(firstBuffer, 0, state);
      device.queue.writeBuffer(paramsBuffer, 0, new Uint8Array(parameterBytes));

      const bindAB = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: firstBuffer } },
          { binding: 1, resource: { buffer: secondBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } }
        ]
      });
      const bindBA = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: secondBuffer } },
          { binding: 1, resource: { buffer: firstBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } }
        ]
      });

      for (let batchStart = 0; batchStart < request.iterations; batchStart += GPU_DISPATCH_BATCH) {
        const batchEnd = Math.min(batchStart + GPU_DISPATCH_BATCH, request.iterations);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        for (let iteration = batchStart; iteration < batchEnd; iteration += 1) {
          pass.setBindGroup(0, iteration % 2 === 0 ? bindAB : bindBA);
          pass.dispatchWorkgroups(Math.ceil(request.size / 8), Math.ceil(request.size / 8));
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
      }

      const source = request.iterations % 2 === 0 ? firstBuffer : secondBuffer;
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(source, 0, readbackBuffer, 0, bytes);
      device.queue.submit([encoder.finish()]);
      await readbackBuffer.mapAsync(MAP_READ);
      readbackMapped = true;
      const mapped = new Float32Array(readbackBuffer.getMappedRange().slice(0));
      readbackBuffer.unmap();
      readbackMapped = false;
      return Float32Array.from(
        { length: itemCount },
        (_, index) => mapped[index * 2 + 1] ?? 0
      );
    } finally {
      if (readbackMapped) readback?.unmap();
      first?.destroy();
      second?.destroy();
      params?.destroy();
      readback?.destroy();
    }
  }

  private async reactionDiffusionCpu(request: Readonly<SimulationRequest>): Promise<Float32Array> {
    const { size, iterations, seed } = request;
    const reactionSettings = request.reactionDiffusion ?? DEFAULT_REACTION_DIFFUSION;
    let a = new Float32Array(size * size).fill(1);
    let b = new Float32Array(size * size);
    let nextA = new Float32Array(a.length);
    let nextB = new Float32Array(b.length);
    for (let index = 0; index < b.length; index += 1) {
      if (hash(index + seed * 7919) > 0.94) b[index] = 1;
    }
    const sample = (field: Float32Array, x: number, y: number): number =>
      field[((y + size) % size) * size + ((x + size) % size)] ?? 0;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = y * size + x;
          const av = a[index] ?? 0;
          const bv = b[index] ?? 0;
          const lapA = sample(a, x - 1, y) + sample(a, x + 1, y) +
            sample(a, x, y - 1) + sample(a, x, y + 1) - av * 4;
          const lapB = sample(b, x - 1, y) + sample(b, x + 1, y) +
            sample(b, x, y - 1) + sample(b, x, y + 1) - bv * 4;
          const reaction = av * bv * bv;
          nextA[index] = Math.max(0, Math.min(
            1,
            av + reactionSettings.diffusionA * lapA - reaction + reactionSettings.feed * (1 - av)
          ));
          nextB[index] = Math.max(0, Math.min(
            1,
            bv + reactionSettings.diffusionB * lapB + reaction -
              (reactionSettings.feed + reactionSettings.kill) * bv
          ));
        }
      }
      [a, nextA] = [nextA, a];
      [b, nextB] = [nextB, b];
      if ((iteration + 1) % CPU_YIELD_INTERVAL === 0) await waitForTask();
    }
    return b;
  }

  private async thermalErosionCpu(request: Readonly<SimulationRequest>): Promise<Float32Array> {
    const { size, iterations, seed } = request;
    const rate = request.erosionRate ?? DEFAULT_EROSION_RATE;
    let field = Float32Array.from(
      { length: size * size },
      (_, index) => hash(index + seed * 3571)
    );
    let next = new Float32Array(field.length);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (let y = 0; y < size; y += 1) {
        const up = (y + size - 1) % size;
        const down = (y + 1) % size;
        for (let x = 0; x < size; x += 1) {
          const left = (x + size - 1) % size;
          const right = (x + 1) % size;
          const index = y * size + x;
          const center = field[index] ?? 0;
          const average = (
            (field[y * size + left] ?? 0) +
            (field[y * size + right] ?? 0) +
            (field[up * size + x] ?? 0) +
            (field[down * size + x] ?? 0)
          ) * 0.25;
          next[index] = center + (average - center) * rate;
        }
      }
      [field, next] = [next, field];
      if ((iteration + 1) % CPU_YIELD_INTERVAL === 0) await waitForTask();
    }
    return field;
  }
}
