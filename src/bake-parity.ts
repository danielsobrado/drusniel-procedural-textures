import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DEFAULT_PHYSICAL, DEFAULT_SYNTHESIS } from './app/constants';
import { MaterialCompiler } from './materials/MaterialCompiler';
import { MATERIAL_PRESETS } from './materials/presets';
import { TextureBaker, type BakeChannel, type BakedTextureSet } from './export/TextureBaker';
import { WebGpuTextureBaker } from './export/WebGpuTextureBaker';
import { createOptionalWebGlRenderer } from './engine/WebGlRenderer';

/**
 * WebGPU bake parity gate. The control case must be byte-exact; authored presets may differ
 * across GLSL and TSL implementations only within the configured channel tolerance.
 *
 * The Node runner launches the WebGL reference and WebGPU candidate in separate browser
 * processes. This keeps ANGLE's OpenGL reference isolated from the real WebGPU adapter required
 * by the candidate on Windows.
 */
const CHANNELS: readonly BakeChannel[] = [
  'albedo', 'roughness', 'normal', 'height',
  'clearcoat', 'clearcoat-roughness', 'metallic', 'ao', 'emissive'
];

interface RendererBackend {
  isWebGPUBackend?: boolean;
}

export interface ChannelDelta {
  channel: BakeChannel;
  maxDelta: number;
  meanDelta: number;
  differingPixels: number;
  referenceMean: number;
  candidateMean: number;
  candidateConstant: boolean;
}

export interface PresetParity {
  preset: string;
  /** Control channels are exact; authored presets are bounded by ParityReport.threshold. */
  isControl: boolean;
  channels: ChannelDelta[];
}

export interface ParityReport {
  attachments?: string[];
  diagnostics?: string[];
  ok: boolean;
  threshold: number;
  resolution: number;
  backend: string;
  presets: PresetParity[];
  error?: string;
}

interface SerializedPresetReference {
  preset: string;
  isControl: boolean;
  channels: Record<BakeChannel, string>;
}

interface SerializedReferenceBundle {
  resolution: number;
  presets: SerializedPresetReference[];
}

interface BrowserParityReport extends ParityReport {
  references?: SerializedReferenceBundle;
}

function pixelsOf(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Parity harness needs a 2D canvas.');
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

async function pixelsFromDataUrl(dataUrl: string): Promise<Uint8ClampedArray> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('Could not decode a serialized WebGL reference bake.');
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('Parity harness needs a 2D reference canvas.');
    context.drawImage(bitmap, 0, 0);
    return pixelsOf(canvas);
  } finally {
    bitmap.close();
  }
}

function compare(
  channel: BakeChannel,
  left: Uint8ClampedArray,
  right: Uint8ClampedArray
): ChannelDelta {
  if (left.length !== right.length) {
    throw new Error(`Channel ${channel} differs in size between backends.`);
  }
  let maxDelta = 0;
  let total = 0;
  let differingPixels = 0;
  let referenceTotal = 0;
  let candidateTotal = 0;
  let candidateMin = 255;
  let candidateMax = 0;
  for (let index = 0; index < left.length; index += 4) {
    let pixelDiffers = false;
    for (let channelOffset = 0; channelOffset < 3; channelOffset += 1) {
      const reference = left[index + channelOffset] ?? 0;
      const candidate = right[index + channelOffset] ?? 0;
      const delta = Math.abs(reference - candidate);
      if (delta > maxDelta) maxDelta = delta;
      total += delta;
      referenceTotal += reference;
      candidateTotal += candidate;
      if (candidate < candidateMin) candidateMin = candidate;
      if (candidate > candidateMax) candidateMax = candidate;
      if (delta !== 0) pixelDiffers = true;
    }
    if (pixelDiffers) differingPixels += 1;
  }
  const samples = left.length / 4 * 3;
  return {
    channel,
    maxDelta,
    meanDelta: total / samples,
    differingPixels,
    referenceMean: referenceTotal / samples,
    candidateMean: candidateTotal / samples,
    candidateConstant: candidateMin === candidateMax
  };
}

function canvasFor(set: BakedTextureSet, channel: BakeChannel): HTMLCanvasElement {
  switch (channel) {
    case 'albedo': return set.albedo.canvas;
    case 'roughness': return set.roughness.canvas;
    case 'normal': return set.normal.canvas;
    case 'height': return set.height.canvas;
    case 'clearcoat': return set.clearcoat.canvas;
    case 'clearcoat-roughness': return set.clearcoatRoughness.canvas;
    case 'metallic': return set.metallic.canvas;
    case 'ao': return set.ao.canvas;
    case 'emissive': return set.emissive.canvas;
  }
}

function channelsPass(channels: readonly ChannelDelta[], isControl: boolean, threshold: number): boolean {
  const maximumAllowedDelta = isControl ? 0 : threshold;
  return channels.every((channel) => channel.maxDelta <= maximumAllowedDelta);
}

function requireWebGpuBackend(renderer: WebGPURenderer): void {
  const backend = (renderer as unknown as { backend?: RendererBackend }).backend;
  if (backend?.isWebGPUBackend !== true) {
    throw new Error('WebGPU parity requires a real WebGPU backend; Three.js fell back to WebGL2.');
  }
}

function selectParityPresets(limit: number): readonly (typeof MATERIAL_PRESETS)[number][] {
  const count = Math.min(MATERIAL_PRESETS.length, Math.max(0, Math.floor(limit)));
  if (count === 0) return [];
  if (count >= MATERIAL_PRESETS.length) return MATERIAL_PRESETS;
  if (count === 1) return [MATERIAL_PRESETS[0]!];

  return Array.from({ length: count }, (_, index) => {
    const presetIndex = Math.round(index * (MATERIAL_PRESETS.length - 1) / (count - 1));
    return MATERIAL_PRESETS[presetIndex]!;
  });
}

function createParityEntries(presetLimit: number) {
  const control = {
    id: '(control) single base layer',
    layers: [{
      ...(MATERIAL_PRESETS[0]?.layers[0] ?? {}),
      kind: 'base',
      pattern: null,
      texture: null,
      strength: 0,
      displacement: 0,
      roughness: 0
    }],
    groups: [],
    physical: undefined,
    synthesis: undefined
  } as unknown as (typeof MATERIAL_PRESETS)[number];

  return [control, ...selectParityPresets(presetLimit)].map((preset) => ({
    preset,
    physical: { ...DEFAULT_PHYSICAL, ...(preset.physical ?? {}) },
    synthesis: { ...DEFAULT_SYNTHESIS, ...(preset.synthesis ?? {}) }
  }));
}

async function runReference(resolution: number, threshold: number, presetLimit: number): Promise<BrowserParityReport> {
  const entries = createParityEntries(presetLimit);
  const references: SerializedReferenceBundle = { resolution, presets: [] };
  const geometry = new THREE.PlaneGeometry(2.5, 2.5, 1, 1);
  const webGlCanvas = document.querySelector<HTMLCanvasElement>('#webgl-canvas') ?? undefined;
  const webGlRenderer = createOptionalWebGlRenderer({
    canvas: webGlCanvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance'
  });
  if (webGlRenderer === null) {
    geometry.dispose();
    throw new Error('Parity needs WebGL2 for the reference bake.');
  }

  try {
    console.log('[parity] WebGL reference phase');
    for (const { preset, physical, synthesis } of entries) {
      const compiler = new MaterialCompiler();
      try {
        compiler.setTextureSupportRendererProvider(async () => webGlRenderer);
        compiler.sync(preset.layers, preset.groups ?? [], false, synthesis);
        compiler.applyPhysical(physical);
        await compiler.ensureSimulationReady();
        const mesh = new THREE.Mesh(geometry);
        mesh.name = `parity ${preset.id}`;
        console.log(`[parity] Reference baking ${preset.id}...`);
        const baked = await new TextureBaker(webGlRenderer, compiler).bake(mesh, physical, resolution);
        const channels = Object.fromEntries(CHANNELS.map((channel) => [
          channel,
          canvasFor(baked, channel).toDataURL('image/png')
        ])) as Record<BakeChannel, string>;
        references.presets.push({
          preset: preset.id,
          isControl: preset.id.startsWith('(control)'),
          channels
        });
      } finally {
        compiler.dispose();
      }
    }
    return {
      ok: true,
      threshold,
      resolution,
      backend: 'webgl',
      presets: [],
      references
    };
  } finally {
    webGlRenderer.dispose();
    geometry.dispose();
  }
}

async function runCandidate(
  resolution: number,
  threshold: number,
  presetLimit: number,
  references: SerializedReferenceBundle | undefined
): Promise<ParityReport> {
  if (references === undefined) throw new Error('WebGPU parity is missing its WebGL reference bundle.');
  if (references.resolution !== resolution) throw new Error('WebGL and WebGPU parity resolutions differ.');

  const entries = createParityEntries(presetLimit);
  const referenceByPreset = new Map(references.presets.map((entry) => [entry.preset, entry]));
  const report: ParityReport = { ok: false, threshold, resolution, backend: 'unknown', presets: [] };
  const geometry = new THREE.PlaneGeometry(2.5, 2.5, 1, 1);
  const webGpuCanvas = document.querySelector<HTMLCanvasElement>('#webgpu-canvas') ?? undefined;
  const webGpuRenderer = new WebGPURenderer({
    canvas: webGpuCanvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance'
  });

  try {
    await webGpuRenderer.init();
    requireWebGpuBackend(webGpuRenderer);
    report.backend = 'webgpu';
    let ok = true;

    console.log('[parity] WebGPU candidate phase');
    for (const { preset, physical, synthesis } of entries) {
      const reference = referenceByPreset.get(preset.id);
      if (reference === undefined) throw new Error(`Missing WebGL reference for preset "${preset.id}".`);

      const compiler = new MaterialCompiler();
      try {
        compiler.setTextureSupportRendererProvider(async () => webGpuRenderer);
        compiler.sync(preset.layers, preset.groups ?? [], false, synthesis);
        compiler.applyPhysical(physical);
        await compiler.ensureSimulationReady();
        const mesh = new THREE.Mesh(geometry);
        mesh.name = `parity ${preset.id}`;
        console.log(`[parity] Candidate baking ${preset.id}...`);
        const candidate = await new WebGpuTextureBaker(webGpuRenderer, compiler)
          .bakeAll(mesh, physical, resolution);
        const channels = await Promise.all(CHANNELS.map(async (channel) => compare(
          channel,
          await pixelsFromDataUrl(reference.channels[channel]),
          pixelsOf(canvasFor(candidate, channel))
        )));
        if (!channelsPass(channels, reference.isControl, threshold)) ok = false;
        report.presets.push({ preset: preset.id, isControl: reference.isControl, channels });
      } finally {
        compiler.dispose();
      }
    }

    report.ok = ok;
    return report;
  } finally {
    webGpuRenderer.dispose();
    geometry.dispose();
  }
}

declare global {
  interface Window {
    ptlBakeParity?: BrowserParityReport;
    ptlBakeReferences?: SerializedReferenceBundle;
  }
}

const diagnostics: string[] = [];
for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    diagnostics.push(`[${level}] ${args.map((value) => String(value)).join(' ')}`.slice(0, 400));
    original(...args);
  };
}
window.addEventListener('unhandledrejection', (event) => {
  diagnostics.push(`[rejection] ${String(event.reason)}`.slice(0, 400));
});

const params = new URLSearchParams(window.location.search);
const resolution = Number.parseInt(params.get('resolution') ?? '256', 10);
const threshold = Number.parseInt(params.get('threshold') ?? '2', 10);
const presetLimit = Number.parseInt(params.get('presets') ?? '4', 10);
const mode = params.get('mode') ?? 'candidate';

const run = mode === 'reference'
  ? runReference(resolution, threshold, presetLimit)
  : runCandidate(resolution, threshold, presetLimit, window.ptlBakeReferences);

run
  .then((report) => { window.ptlBakeParity = { ...report, diagnostics }; })
  .catch((error: unknown) => {
    window.ptlBakeParity = {
      ok: false,
      threshold,
      resolution,
      backend: 'unavailable',
      presets: [],
      diagnostics,
      error: error instanceof Error ? `${error.message}` : String(error)
    };
  });
