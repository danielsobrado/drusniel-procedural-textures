import { access, cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const configPath = resolve(root, 'config/texture-library.yaml');
const threeBasisPath = resolve(root, 'node_modules/three/examples/jsm/libs/basis');

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function safeSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/iu.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return value;
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.replace(/^\/+|\/+$/gu, '');
  if (normalized.length === 0 || normalized.includes('..') || normalized.includes('\\')) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return normalized;
}

const config = record(parse(await readFile(configPath, 'utf8')), 'Texture library configuration');
if (config.version !== 2) throw new Error(`Unsupported texture library config version: ${String(config.version)}.`);
const basePath = safeRelativePath(config.basePath, 'Texture library base path');
const transcoderPath = safeRelativePath(config.transcoderPath, 'Texture library transcoder path');
const generation = record(config.generation, 'Texture library generation');
const referencedResolution = generation.referencedResolution;
const longTailResolution = generation.longTailResolution;
const encodedByteBudget = generation.encodedByteBudget;
if (![referencedResolution, longTailResolution, encodedByteBudget].every(Number.isSafeInteger)) {
  throw new Error('Texture library generation resolutions and byte budget must be integers.');
}
if (!Array.isArray(generation.highResolutionFiles) || generation.highResolutionFiles.length === 0) {
  throw new Error('Texture library generation must declare high-resolution files.');
}
const highResolutionFiles = new Set(generation.highResolutionFiles.map((file, index) =>
  safeSegment(String(file).replace(/\.ktx2$/u, ''), `High-resolution file ${index + 1}`) + '.ktx2'));
if (!Array.isArray(config.families) || config.families.length === 0) {
  throw new Error('Texture library must define at least one family.');
}

const expected = new Set();
const packedSlots = new Set();
let fieldCount = 0;
for (const [familyIndex, familyValue] of config.families.entries()) {
  const family = record(familyValue, `Texture family ${familyIndex + 1}`);
  const familyId = safeSegment(family.id, `Texture family ${familyIndex + 1} id`);
  if (!Array.isArray(family.variants) || family.variants.length === 0) {
    throw new Error(`Texture family ${familyId} must contain variants.`);
  }
  for (const [variantIndex, variantValue] of family.variants.entries()) {
    const variant = record(variantValue, `Texture family ${familyId} variant ${variantIndex + 1}`);
    safeSegment(variant.id, `Texture family ${familyId} variant ${variantIndex + 1} id`);
    const file = `${safeSegment(String(variant.file).replace(/\.ktx2$/u, ''), `Texture family ${familyId} file`)}.ktx2`;
    if (!['r', 'g', 'b', 'a'].includes(variant.channel)) {
      throw new Error(`Texture family ${familyId} variant ${String(variant.id)} has an invalid packed channel.`);
    }
    const slot = `${file}:${variant.channel}`;
    if (packedSlots.has(slot)) throw new Error(`Packed texture channel is assigned more than once: ${slot}.`);
    packedSlots.add(slot);
    expected.add(file);
    fieldCount += 1;
  }
}

const textureDirectory = resolve(root, 'public', basePath);
const actual = new Set((await readdir(textureDirectory)).filter((name) => name.endsWith('.ktx2')));
const missing = [...expected].filter((name) => !actual.has(name));
const unregistered = [...actual].filter((name) => !expected.has(name));
if (missing.length > 0 || unregistered.length > 0) {
  const details = [
    missing.length === 0 ? null : `missing: ${missing.join(', ')}`,
    unregistered.length === 0 ? null : `unregistered: ${unregistered.join(', ')}`
  ].filter(Boolean).join('; ');
  throw new Error(`Texture library catalog does not match public assets (${details}).`);
}

const KTX2_IDENTIFIER = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
let encodedBytes = 0;
for (const file of expected) {
  const path = resolve(textureDirectory, file);
  const header = (await readFile(path)).subarray(0, 48);
  if (header.length < 48 || !header.subarray(0, 12).equals(KTX2_IDENTIFIER)) {
    throw new Error(`Texture library file is not KTX2: ${file}.`);
  }
  const width = header.readUInt32LE(20);
  const height = header.readUInt32LE(24);
  const supercompression = header.readUInt32LE(44);
  const expectedResolution = highResolutionFiles.has(file) ? referencedResolution : longTailResolution;
  if (width !== expectedResolution || height !== expectedResolution) {
    throw new Error(`${file} must be ${expectedResolution}x${expectedResolution}, found ${width}x${height}.`);
  }
  if (header.readUInt32LE(12) !== 0 || supercompression !== 2) {
    throw new Error(`${file} must contain Basis UASTC data with Zstandard supercompression.`);
  }
  encodedBytes += (await stat(path)).size;
}
if (encodedBytes > encodedByteBudget) {
  throw new Error(`Texture library exceeds its ${encodedByteBudget}-byte budget (${encodedBytes} bytes).`);
}

const transcoderOutput = resolve(root, 'public', transcoderPath);
await mkdir(transcoderOutput, { recursive: true });
for (const fileName of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  const source = resolve(threeBasisPath, fileName);
  await access(source);
  await cp(source, resolve(transcoderOutput, fileName));
}

console.log(
  `Texture library ready: ${fieldCount} stable fields in ${expected.size} UASTC/Zstd KTX2 packs ` +
  `(${encodedBytes} bytes); Basis transcoder synchronized.`
);
