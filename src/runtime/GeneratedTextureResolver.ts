import * as THREE from 'three';
import { createFrameBudget } from '../core/scheduling/FrameBudget';
import type { ResolvedTextureField } from '../core/texture/ResolvedTextureField';
import type { TextureResolver } from './TextureResolver';

const DEFAULT_RESOLUTION = 256;
const MIN_RESOLUTION = 32;
const MAX_RESOLUTION = 512;
const GENERATION_BUDGET_MS = 5;
const SAFE_FIELD_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;

/** Compatibility version for deterministic code-generated texture fields. */
export const PTL_GENERATED_TEXTURE_FIELD_VERSION = 1;

export const PTL_GENERATED_TEXTURE_FIELD_FAMILIES = [
  'cracks',
  'craters',
  'crystal',
  'gabor',
  'grainy',
  'manifold',
  'marble',
  'melt',
  'milky',
  'organic',
  'perlin',
  'radial',
  'rock',
  'spokes',
  'stone',
  'streak',
  'super-noise',
  'super-perlin',
  'swirl',
  'techno',
  'tiles',
  'turbulence',
  'vein',
  'voronoi'
] as const;

const GENERATED_FAMILY_SET = new Set<string>(PTL_GENERATED_TEXTURE_FIELD_FAMILIES);

export interface GeneratedTextureResolverOptions {
  /** Power-of-two field size. Higher values trade preparation time and memory for detail. */
  resolution?: number;
  /** Generate generic noise for non-PTL family ids instead of rejecting missing custom assets. */
  allowUnknownFamilies?: boolean;
}

interface GeneratedTextureEntry {
  binding: ResolvedTextureField;
  references: number;
}

function normalizeResolution(value: unknown): number {
  if (value === undefined) return DEFAULT_RESOLUTION;
  if (
    !Number.isInteger(value) ||
    (value as number) < MIN_RESOLUTION ||
    (value as number) > MAX_RESOLUTION ||
    ((value as number) & ((value as number) - 1)) !== 0
  ) {
    throw new Error(
      `Generated texture-field resolution must be a power of two from ${MIN_RESOLUTION} to ${MAX_RESOLUTION}.`
    );
  }
  return value as number;
}

function hash32(value: number): number {
  let hash = value | 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function seedFor(id: string): number {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    seed ^= id.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function lattice(seed: number, x: number, y: number, cells: number): number {
  const wrappedX = (x + cells) % cells;
  const wrappedY = (y + cells) % cells;
  return (hash32(seed ^ Math.imul(wrappedX, 0x9e3779b1) ^ Math.imul(wrappedY, 0x85ebca77)) & 0xffff) / 0xffff;
}

function periodicNoise(seed: number, u: number, v: number, cells: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx0 = x - x0;
  const ty0 = y - y0;
  const tx = tx0 * tx0 * (3 - 2 * tx0);
  const ty = ty0 * ty0 * (3 - 2 * ty0);
  const top = lattice(seed, x0, y0, cells) * (1 - tx) + lattice(seed, x0 + 1, y0, cells) * tx;
  const bottom = lattice(seed, x0, y0 + 1, cells) * (1 - tx) + lattice(seed, x0 + 1, y0 + 1, cells) * tx;
  return top * (1 - ty) + bottom * ty;
}

function fbm(seed: number, u: number, v: number, cells: number): number {
  return (
    periodicNoise(seed, u, v, cells) * 0.58 +
    periodicNoise(seed ^ 0xa511e9b3, u, v, cells * 2) * 0.28 +
    periodicNoise(seed ^ 0x63d83595, u, v, cells * 4) * 0.14
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function generatedValue(
  family: string,
  noise: number,
  u: number,
  v: number,
  seed: number,
  variant: number
): number {
  const tau = Math.PI * 2;
  const frequency = 3 + variant % 9;
  const phase = (seed & 0xffff) / 0xffff * tau;
  const wave = 0.5 + 0.5 * Math.sin((u * frequency + v * (frequency + 2)) * tau + phase);
  const cross = 0.5 + 0.5 * Math.sin((u * (frequency + 3) - v * frequency) * tau + noise * 3 + phase);
  const contour = Math.max(0, 1 - Math.abs(noise - 0.5) * (9 + variant));

  switch (family) {
    case 'cracks':
      return contour ** 2.4;
    case 'craters': {
      const torusX = Math.sin(u * tau);
      const torusY = Math.sin(v * tau);
      const ring = 0.5 + 0.5 * Math.sin((Math.hypot(torusX, torusY) + noise * 0.2) * tau * frequency);
      return Math.max(0, 1 - Math.abs(ring - 0.68) * 5);
    }
    case 'crystal':
    case 'voronoi':
      return clamp01(contour * 0.8 + Math.abs(noise - 0.5) * 1.25);
    case 'gabor':
    case 'streak':
      return clamp01(wave * 0.72 + noise * 0.34);
    case 'grainy':
      return clamp01(noise * 0.58 + cross * 0.42);
    case 'manifold':
    case 'swirl':
      return 0.5 + 0.5 * Math.sin((cross + noise * 1.6) * tau * (1 + variant * 0.07));
    case 'marble':
      return 0.5 + 0.5 * Math.sin((u * frequency + noise * (1.4 + variant * 0.08)) * tau);
    case 'melt':
      return (0.5 + 0.5 * Math.sin((v * frequency + noise * 1.2) * tau)) ** 1.7;
    case 'milky':
      return clamp01(0.18 + noise * 0.68 + cross * 0.14);
    case 'organic':
      return clamp01(contour * 0.45 + noise * 0.75);
    case 'radial':
      return 0.5 + 0.5 * Math.sin((Math.sin(u * tau) + Math.sin(v * tau) + noise * 0.18) * tau * frequency);
    case 'rock':
    case 'stone':
      return clamp01(noise ** 1.2 * 0.76 + contour * 0.32);
    case 'spokes':
      return Math.max(0, 1 - Math.abs(cross - 0.5) * (3 + variant * 0.4));
    case 'techno': {
      const gridX = Math.min((u * frequency) % 1, 1 - (u * frequency) % 1);
      const gridY = Math.min((v * (frequency + 2)) % 1, 1 - (v * (frequency + 2)) % 1);
      return Math.max(gridX < 0.055 ? 1 : 0, gridY < 0.055 ? 1 : 0, noise > 0.72 ? 0.65 : 0.08);
    }
    case 'tiles': {
      const tileX = Math.min((u * frequency) % 1, 1 - (u * frequency) % 1);
      const tileY = Math.min((v * frequency) % 1, 1 - (v * frequency) % 1);
      return Math.min(tileX, tileY) < 0.075 ? 0.05 : 0.55 + noise * 0.45;
    }
    case 'turbulence':
      return clamp01(Math.abs(noise * 2 - 1) * 1.35 + cross * 0.2);
    case 'vein':
      return contour ** 1.35 * (0.55 + cross * 0.45);
    case 'super-noise':
      return clamp01(noise * 0.78 + cross * 0.28);
    case 'super-perlin':
      return clamp01(noise ** 0.82 * 0.88 + wave * 0.18);
    default:
      return noise;
  }
}

async function generateTexture(id: string, resolution: number): Promise<THREE.DataTexture> {
  const [family = 'field', variantText = '1'] = id.toLowerCase().split('.', 2);
  const variant = Number.parseInt(variantText, 10) || 1;
  const seed = seedFor(id);
  const cells = 5 + seed % 8 + variant % 4;
  const pixels = new Uint8Array(resolution * resolution);
  const period = resolution - 1;
  const budget = createFrameBudget(GENERATION_BUDGET_MS);

  for (let y = 0; y < resolution; y += 1) {
    const v = y / period;
    for (let x = 0; x < resolution; x += 1) {
      const u = x / period;
      const noise = fbm(seed, u, v, cells);
      pixels[y * resolution + x] = Math.round(clamp01(
        generatedValue(family, noise, u, v, seed, variant)
      ) * 255);
    }
    if (budget.isDue()) await budget.yieldIfDue();
  }

  const texture = new THREE.DataTexture(
    pixels,
    resolution,
    resolution,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  texture.name = `PTL Generated Field v${PTL_GENERATED_TEXTURE_FIELD_VERSION} ${id}`;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Code-only texture-field source for self-contained Runtime Package deployments.
 * Hosted catalog assets remain the recommended path when exact Lab fidelity matters.
 */
export class GeneratedTextureResolver implements TextureResolver {
  public readonly resolution: number;
  public readonly allowUnknownFamilies: boolean;
  private readonly entries = new Map<string, GeneratedTextureEntry>();
  private readonly pending = new Map<string, Promise<ResolvedTextureField>>();
  private readonly pendingReferences = new Map<string, number>();
  private generationTail: Promise<void> = Promise.resolve();
  private disposed = false;

  public constructor(options: Readonly<GeneratedTextureResolverOptions> = {}) {
    this.resolution = normalizeResolution(options.resolution);
    if (
      options.allowUnknownFamilies !== undefined &&
      typeof options.allowUnknownFamilies !== 'boolean'
    ) {
      throw new Error('Generated texture-field allowUnknownFamilies must be a boolean.');
    }
    this.allowUnknownFamilies = options.allowUnknownFamilies ?? false;
  }

  public async resolve(id: string): Promise<ResolvedTextureField> {
    this.assertUsable();
    if (!SAFE_FIELD_ID.test(id)) throw new Error(`Invalid generated texture-field id: ${id}.`);
    const [family = ''] = id.toLowerCase().split('.', 1);
    if (!this.allowUnknownFamilies && !GENERATED_FAMILY_SET.has(family)) {
      throw new Error(
        `Generated texture-field family "${family}" is not built in. ` +
        'Provide a TextureResolver or enable allowUnknownFamilies explicitly.'
      );
    }
    const existing = this.entries.get(id);
    if (existing !== undefined) {
      existing.references += 1;
      return existing.binding;
    }

    const pending = this.pending.get(id);
    if (pending !== undefined) {
      this.pendingReferences.set(id, (this.pendingReferences.get(id) ?? 1) + 1);
      return pending;
    }

    this.pendingReferences.set(id, 1);
    const generation = this.generationTail.then(async () => {
      this.assertUsable();
      const texture = await generateTexture(id, this.resolution);
      if (this.disposed) {
        texture.dispose();
        throw new Error('Generated texture resolver has been disposed.');
      }
      const binding: ResolvedTextureField = { texture, channel: 'r' };
      this.entries.set(id, {
        binding,
        references: this.pendingReferences.get(id) ?? 1
      });
      return binding;
    });
    const promise = generation.finally(() => {
      this.pending.delete(id);
      this.pendingReferences.delete(id);
    });
    this.pending.set(id, promise);
    this.generationTail = promise.then(() => undefined, () => undefined);
    return promise;
  }

  public release(id: string, texture: THREE.Texture): void {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.binding.texture !== texture) return;
    entry.references -= 1;
    if (entry.references > 0) return;
    entry.binding.texture.dispose();
    this.entries.delete(id);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.binding.texture.dispose();
    this.entries.clear();
    this.pending.clear();
    this.pendingReferences.clear();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('Generated texture resolver has been disposed.');
  }
}
