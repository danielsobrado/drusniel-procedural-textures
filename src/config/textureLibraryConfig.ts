import { parse } from 'yaml';
import rawConfig from '../../config/texture-library.yaml?raw';
import type { TextureFieldChannel } from '../core/texture/TextureFieldSettings';

export type TextureAssetUsage = 'height' | 'mask' | 'roughness' | 'color';

export interface TextureLibraryAsset {
  id: string;
  family: string;
  variant: string;
  label: string;
  file: string;
  path: string;
  channel: TextureFieldChannel;
  type: 'scalar';
  colorSpace: 'linear';
  tileable: boolean;
  usages: readonly TextureAssetUsage[];
  provenance: string;
  license: string;
  source: string;
}

export interface TextureLibraryGenerationConfig {
  source: string;
  encoder: string;
  format: 'UASTC';
  supercompression: 'Zstandard';
  referencedResolution: number;
  longTailResolution: number;
  encodedByteBudget: number;
  highResolutionFiles: readonly string[];
}

export interface TextureLibraryConfig {
  version: 2;
  basePath: string;
  transcoderPath: string;
  generation: TextureLibraryGenerationConfig;
  assets: readonly TextureLibraryAsset[];
}

const SAFE_TOKEN = /^[a-z0-9][a-z0-9-]{0,63}$/iu;
const SAFE_KTX2_FILE = /^[a-z0-9][a-z0-9-]{0,127}\.ktx2$/iu;
const USAGES = new Set<TextureAssetUsage>(['height', 'mask', 'roughness', 'color']);
const CHANNELS = new Set<TextureFieldChannel>(['r', 'g', 'b', 'a']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value;
}

function token(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!SAFE_TOKEN.test(result)) throw new Error(`${label} contains unsupported characters.`);
  return result;
}

function relativePath(value: unknown, label: string): string {
  const result = text(value, label, 128).replace(/^\/+|\/+$/gu, '');
  if (result.length === 0 || result.includes('..') || result.includes('\\')) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

function ktx2File(value: unknown, label: string): string {
  const result = text(value, label, 132);
  if (!SAFE_KTX2_FILE.test(result)) throw new Error(`${label} must be a safe KTX2 filename.`);
  return result;
}

function usageList(value: unknown): TextureAssetUsage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Texture library usages must not be empty.');
  return value.map((item, index) => {
    if (typeof item !== 'string' || !USAGES.has(item as TextureAssetUsage)) {
      throw new Error(`Texture library usage ${index + 1} is unsupported.`);
    }
    return item as TextureAssetUsage;
  });
}

export function normalizeTextureLibraryConfig(value: unknown): TextureLibraryConfig {
  const root = record(value, 'Texture library configuration');
  if (root.version !== 2) throw new Error(`Unsupported texture library config version: ${String(root.version)}.`);
  const basePath = relativePath(root.basePath, 'Texture library base path');
  const transcoderPath = relativePath(root.transcoderPath, 'Texture library transcoder path');
  const generationInput = record(root.generation, 'Texture library generation');
  if (generationInput.format !== 'UASTC' || generationInput.supercompression !== 'Zstandard') {
    throw new Error('Texture library generation must use UASTC with Zstandard supercompression.');
  }
  if (!Array.isArray(generationInput.highResolutionFiles) || generationInput.highResolutionFiles.length === 0) {
    throw new Error('Texture library generation must declare its high-resolution files.');
  }
  const generation: TextureLibraryGenerationConfig = {
    source: relativePath(generationInput.source, 'Texture library generation source'),
    encoder: text(generationInput.encoder, 'Texture library encoder'),
    format: 'UASTC',
    supercompression: 'Zstandard',
    referencedResolution: positiveInteger(generationInput.referencedResolution, 'Referenced texture resolution'),
    longTailResolution: positiveInteger(generationInput.longTailResolution, 'Long-tail texture resolution'),
    encodedByteBudget: positiveInteger(generationInput.encodedByteBudget, 'Encoded texture byte budget'),
    highResolutionFiles: generationInput.highResolutionFiles.map((file, index) =>
      ktx2File(file, `High-resolution texture file ${index + 1}`))
  };
  const defaults = record(root.defaults, 'Texture library defaults');
  if (defaults.type !== 'scalar') throw new Error('Texture library currently supports scalar fields only.');
  if (defaults.colorSpace !== 'linear') throw new Error('Texture fields must use linear color space.');
  if (defaults.tileable !== true) throw new Error('Texture library fields must be marked tileable.');
  const usages = usageList(defaults.usages);
  const provenance = text(defaults.provenance, 'Texture library provenance');
  const license = text(defaults.license, 'Texture library license');
  const source = relativePath(defaults.source, 'Texture library source');
  if (!Array.isArray(root.families) || root.families.length === 0) {
    throw new Error('Texture library must define at least one family.');
  }

  const assets: TextureLibraryAsset[] = [];
  for (const [familyIndex, familyValue] of root.families.entries()) {
    const family = record(familyValue, `Texture family ${familyIndex + 1}`);
    const familyId = token(family.id, `Texture family ${familyIndex + 1} id`);
    if (!Array.isArray(family.variants) || family.variants.length === 0) {
      throw new Error(`Texture family ${familyId} must contain variants.`);
    }
    for (const [variantIndex, variantValue] of family.variants.entries()) {
      const variantInput = record(variantValue, `Texture family ${familyId} variant ${variantIndex + 1}`);
      const variant = token(variantInput.id, `Texture family ${familyId} variant ${variantIndex + 1} id`);
      const file = ktx2File(variantInput.file, `Texture family ${familyId} variant ${variant} file`);
      if (typeof variantInput.channel !== 'string' || !CHANNELS.has(variantInput.channel as TextureFieldChannel)) {
        throw new Error(`Texture family ${familyId} variant ${variant} channel is unsupported.`);
      }
      assets.push({
        id: `${familyId}.${variant}`,
        family: familyId,
        variant,
        label: `${familyId.replace(/-/gu, ' ')} ${variant}`,
        file,
        path: `${basePath}/${file}`,
        channel: variantInput.channel as TextureFieldChannel,
        type: 'scalar',
        colorSpace: 'linear',
        tileable: true,
        usages: [...usages],
        provenance,
        license,
        source
      });
    }
  }
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw new Error('Texture library contains duplicate stable ids.');
  }
  const slots = assets.map((asset) => `${asset.file}:${asset.channel}`);
  if (new Set(slots).size !== slots.length) throw new Error('Texture library assigns a packed channel more than once.');
  const files = new Set(assets.map((asset) => asset.file));
  for (const file of generation.highResolutionFiles) {
    if (!files.has(file)) throw new Error(`High-resolution texture file is not referenced by any asset: ${file}.`);
  }
  return { version: 2, basePath, transcoderPath, generation, assets };
}

export const TEXTURE_LIBRARY_CONFIG = normalizeTextureLibraryConfig(parse(rawConfig) as unknown);
export const TEXTURE_LIBRARY_ASSETS = TEXTURE_LIBRARY_CONFIG.assets;
export const TEXTURE_LIBRARY_ASSET_IDS = TEXTURE_LIBRARY_ASSETS.map((asset) => asset.id);

const ASSET_BY_ID = new Map(TEXTURE_LIBRARY_ASSETS.map((asset) => [asset.id, asset] as const));

export function textureLibraryAsset(id: string): TextureLibraryAsset {
  const asset = ASSET_BY_ID.get(id);
  if (asset === undefined) throw new Error(`Unknown texture library asset: ${id}.`);
  return asset;
}

export function textureLibraryAssetUrl(id: string): string {
  return `${import.meta.env.BASE_URL}${textureLibraryAsset(id).path}`;
}

export function textureLibraryTranscoderUrl(): string {
  return `${import.meta.env.BASE_URL}${TEXTURE_LIBRARY_CONFIG.transcoderPath}/`;
}
