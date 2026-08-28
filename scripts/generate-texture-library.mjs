import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const catalogPath = resolve(root, 'config/texture-library.yaml');
const outputDirectory = resolve(root, 'public/textures');
const expectedOutputDirectory = join(root, 'public', 'textures');
const CHANNEL_INDEX = { r: 0, g: 1, b: 2, a: 3 };
const SINE_TABLE_SIZE = 4096;
const SINE_TABLE = Float32Array.from(
  { length: SINE_TABLE_SIZE },
  (_, index) => 0.5 + 0.5 * Math.sin((index / SINE_TABLE_SIZE) * Math.PI * 2)
);

if (outputDirectory !== expectedOutputDirectory || relative(root, outputDirectory).startsWith('..')) {
  throw new Error(`Refusing to generate outside the repository texture directory: ${outputDirectory}`);
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be text.`);
  return value.trim();
}

function parseCatalog(source) {
  const catalog = record(YAML.parse(source), 'Texture library catalog');
  if (catalog.version !== 2) throw new Error('Texture generation requires catalog version 2.');
  const generation = record(catalog.generation, 'Texture generation metadata');
  const highResolutionFiles = new Set(
    generation.highResolutionFiles.map((file) => text(file, 'High-resolution file'))
  );
  const packs = new Map();
  const ids = new Set();

  for (const familyValue of catalog.families) {
    const family = record(familyValue, 'Texture family');
    const familyId = text(family.id, 'Texture family id');
    for (const variantValue of family.variants) {
      const variant = record(variantValue, `${familyId} texture variant`);
      const variantId = text(variant.id, `${familyId} variant id`);
      const file = text(variant.file, `${familyId}.${variantId} file`);
      const channel = text(variant.channel, `${familyId}.${variantId} channel`);
      if (!(channel in CHANNEL_INDEX)) throw new Error(`Unsupported packed channel: ${channel}.`);
      const id = `${familyId}.${variantId}`;
      if (ids.has(id)) throw new Error(`Duplicate texture id: ${id}.`);
      ids.add(id);

      const channels = packs.get(file) ?? new Map();
      if (channels.has(channel)) throw new Error(`Duplicate packed slot: ${file}#${channel}.`);
      channels.set(channel, { id, family: familyId, variant: variantId });
      packs.set(file, channels);
    }
  }

  return {
    encodedByteBudget: positiveInteger(generation.encodedByteBudget, 'Encoded byte budget'),
    highResolutionFiles,
    longTailResolution: positiveInteger(generation.longTailResolution, 'Long-tail resolution'),
    packs,
    referencedResolution: positiveInteger(generation.referencedResolution, 'Referenced resolution')
  };
}

function hash32(value) {
  let hash = value | 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function seedFor(id) {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    seed ^= id.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function periodicGrid(size, seed) {
  const values = new Uint8Array(size * size);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = hash32(seed + Math.imul(index, 0x9e3779b1)) & 0xff;
  }
  return values;
}

function addUpscaledNoise(target, resolution, cells, seed, weight) {
  const grid = periodicGrid(cells, seed);
  const x0 = new Uint16Array(resolution);
  const x1 = new Uint16Array(resolution);
  const blendX = new Float32Array(resolution);

  for (let x = 0; x < resolution; x += 1) {
    const position = (x / resolution) * cells;
    const base = Math.floor(position);
    const fraction = position - base;
    x0[x] = base;
    x1[x] = (base + 1) % cells;
    blendX[x] = fraction * fraction * (3 - 2 * fraction);
  }

  for (let y = 0; y < resolution; y += 1) {
    const position = (y / resolution) * cells;
    const baseY = Math.floor(position);
    const fractionY = position - baseY;
    const blendY = fractionY * fractionY * (3 - 2 * fractionY);
    const row0 = baseY * cells;
    const row1 = ((baseY + 1) % cells) * cells;
    const targetRow = y * resolution;

    for (let x = 0; x < resolution; x += 1) {
      const tx = blendX[x];
      const top = grid[row0 + x0[x]] * (1 - tx) + grid[row0 + x1[x]] * tx;
      const bottom = grid[row1 + x0[x]] * (1 - tx) + grid[row1 + x1[x]] * tx;
      target[targetRow + x] += ((top * (1 - blendY) + bottom * blendY) / 255) * weight;
    }
  }
}

function sine(phase) {
  const wrapped = ((phase % SINE_TABLE_SIZE) + SINE_TABLE_SIZE) % SINE_TABLE_SIZE;
  return SINE_TABLE[wrapped | 0];
}

function familyValue(family, noise, x, y, resolution, seed, variantNumber) {
  const nx = x / resolution;
  const ny = y / resolution;
  const phase = seed & (SINE_TABLE_SIZE - 1);
  const frequency = 3 + (variantNumber % 9);
  const wave = sine((x * frequency * SINE_TABLE_SIZE) / resolution + phase);
  const cross = sine(((x * (frequency + 1) + y * (frequency + 3)) * SINE_TABLE_SIZE) / resolution + phase);
  const torusX = sine((x * SINE_TABLE_SIZE) / resolution);
  const torusY = sine((y * SINE_TABLE_SIZE) / resolution);
  const contour = Math.max(0, 1 - Math.abs(noise - 0.5) * (9 + variantNumber));
  let value;

  switch (family) {
    case 'cracks':
      value = Math.pow(contour, 2.4);
      break;
    case 'craters': {
      const rings = sine((Math.abs(torusX - 0.5) + Math.abs(torusY - 0.5) + noise * 0.16) * SINE_TABLE_SIZE * frequency);
      value = Math.max(0, 1 - Math.abs(rings - 0.68) * 5);
      break;
    }
    case 'crystal':
    case 'voronoi':
      value = Math.min(1, contour * 0.8 + Math.abs(noise - 0.5) * 1.25);
      break;
    case 'gabor':
      value = wave * (0.35 + noise * 0.65);
      break;
    case 'grainy':
      value = Math.min(1, noise * 0.55 + ((hash32(seed ^ (x + Math.imul(y, resolution))) & 0xff) / 255) * 0.45);
      break;
    case 'manifold':
      value = sine((cross + noise * 1.8) * SINE_TABLE_SIZE * (1 + variantNumber * 0.08));
      break;
    case 'marble':
      value = sine((nx * frequency + noise * (1.4 + variantNumber * 0.08)) * SINE_TABLE_SIZE);
      break;
    case 'melt':
      value = Math.pow(sine((ny * frequency + noise * 1.2) * SINE_TABLE_SIZE), 1.7);
      break;
    case 'milky':
      value = Math.min(1, 0.18 + noise * 0.68 + cross * 0.14);
      break;
    case 'organic':
      value = Math.min(1, contour * 0.45 + noise * 0.75);
      break;
    case 'radial':
      value = sine((torusX + torusY + noise * 0.18) * SINE_TABLE_SIZE * frequency);
      break;
    case 'rock':
    case 'stone':
      value = Math.min(1, Math.pow(noise, 1.2) * 0.76 + contour * 0.32);
      break;
    case 'spokes':
      value = Math.max(0, 1 - Math.abs(cross - 0.5) * (3 + variantNumber * 0.4));
      break;
    case 'streak':
      value = Math.min(1, wave * 0.72 + noise * 0.34);
      break;
    case 'swirl':
      value = sine((cross + (torusX - torusY) * 0.75 + noise * 0.7) * SINE_TABLE_SIZE);
      break;
    case 'techno': {
      const gridX = Math.min(nx * frequency % 1, 1 - (nx * frequency % 1));
      const gridY = Math.min(ny * (frequency + 2) % 1, 1 - (ny * (frequency + 2) % 1));
      value = Math.max(gridX < 0.055 ? 1 : 0, gridY < 0.055 ? 1 : 0, noise > 0.72 ? 0.65 : 0.08);
      break;
    }
    case 'tiles': {
      const tileX = Math.min(nx * frequency % 1, 1 - (nx * frequency % 1));
      const tileY = Math.min(ny * frequency % 1, 1 - (ny * frequency % 1));
      value = Math.min(tileX, tileY) < 0.075 ? 0.05 : 0.55 + noise * 0.45;
      break;
    }
    case 'turbulence':
      value = Math.min(1, Math.abs(noise * 2 - 1) * 1.35 + cross * 0.2);
      break;
    case 'vein':
      value = Math.pow(contour, 1.35) * (0.55 + cross * 0.45);
      break;
    case 'perlin':
      value = noise;
      break;
    case 'super-noise':
      value = Math.min(1, noise * 0.78 + cross * 0.28);
      break;
    case 'super-perlin':
      value = Math.min(1, Math.pow(noise, 0.82) * 0.88 + wave * 0.18);
      break;
    default:
      value = noise;
  }

  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function generateField(resolution, descriptor) {
  const seed = seedFor(descriptor.id);
  const variantNumber = Number.parseInt(descriptor.variant, 10) || 1;
  const baseCells = 5 + (seed % 8) + (variantNumber % 4);
  const noise = new Float32Array(resolution * resolution);
  addUpscaledNoise(noise, resolution, baseCells, seed, 0.58);
  addUpscaledNoise(noise, resolution, baseCells * 2, seed ^ 0xa511e9b3, 0.28);
  addUpscaledNoise(noise, resolution, baseCells * 4, seed ^ 0x63d83595, 0.14);

  const field = new Uint8Array(noise.length);
  for (let y = 0; y < resolution; y += 1) {
    const row = y * resolution;
    for (let x = 0; x < resolution; x += 1) {
      const index = row + x;
      field[index] = familyValue(
        descriptor.family,
        noise[index],
        x,
        y,
        resolution,
        seed,
        variantNumber
      );
    }
  }
  return field;
}

function createPackedPam(resolution, channels) {
  const pixelCount = resolution * resolution;
  const pixels = Buffer.alloc(pixelCount * 4, 128);
  for (const [channel, descriptor] of channels) {
    process.stdout.write(`    ${channel.toUpperCase()}: ${descriptor.id}\n`);
    const field = generateField(resolution, descriptor);
    const channelIndex = CHANNEL_INDEX[channel];
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      pixels[pixel * 4 + channelIndex] = field[pixel];
    }
  }
  const header = Buffer.from(
    `P7\nWIDTH ${resolution}\nHEIGHT ${resolution}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
    'ascii'
  );
  return Buffer.concat([header, pixels]);
}

function runToktx(input, output) {
  execFileSync('toktx', [
    '--encode', 'uastc',
    '--uastc_quality', '2',
    '--uastc_rdo_l', '0.75',
    '--uastc_rdo_m',
    '--zcmp', '18',
    '--genmipmap',
    '--filter', 'kaiser',
    '--assign_oetf', 'linear',
    '--assign_primaries', 'none',
    '--target_type', 'RGBA',
    '--threads', '1',
    '--',
    output,
    input
  ], { stdio: 'inherit' });
}

const catalog = parseCatalog(await readFile(catalogPath, 'utf8'));
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ptl-texture-library-'));
let encodedBytes = 0;

try {
  execFileSync('toktx', ['--version'], { stdio: 'inherit' });
  for (const [file, channels] of [...catalog.packs].sort(([left], [right]) => left.localeCompare(right))) {
    const resolution = catalog.highResolutionFiles.has(file)
      ? catalog.referencedResolution
      : catalog.longTailResolution;
    process.stdout.write(`Generating ${file} (${resolution}x${resolution})\n`);
    const pamPath = join(temporaryDirectory, `${file}.pam`);
    const ktxPath = join(temporaryDirectory, file);
    await writeFile(pamPath, createPackedPam(resolution, channels));
    runToktx(pamPath, ktxPath);
    encodedBytes += (await stat(ktxPath)).size;
    await rm(pamPath);
  }

  if (encodedBytes > catalog.encodedByteBudget) {
    throw new Error(
      `Generated texture library is ${encodedBytes} bytes; budget is ${catalog.encodedByteBudget} bytes.`
    );
  }

  await mkdir(outputDirectory, { recursive: true });
  const expectedFiles = new Set(catalog.packs.keys());
  for (const file of expectedFiles) await copyFile(join(temporaryDirectory, file), join(outputDirectory, file));
  for (const file of await readdir(outputDirectory)) {
    if (file.toLowerCase().endsWith('.ktx2') && !expectedFiles.has(file)) {
      await rm(join(outputDirectory, file));
    }
  }

  process.stdout.write(
    `Generated ${catalog.packs.size} packed UASTC/Zstd textures (${encodedBytes} bytes).\n`
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
