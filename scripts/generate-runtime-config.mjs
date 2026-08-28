import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const outputPath = resolve(root, 'src/core/material/generated/runtimeConfig.ts');
const sources = {
  grass: 'config/grass-pattern.yaml',
  cellular: 'config/cellular.yaml',
  rendererSafety: 'config/renderer-safety.yaml',
  structuredPattern: 'config/structured-pattern.yaml',
  textureField: 'config/texture-field.yaml'
};

async function load(relativePath) {
  return parse(await readFile(resolve(root, relativePath), 'utf8'));
}

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function number(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function validateRanges(config, defaultsKey, limitsKey, keys, label) {
  const defaults = record(config[defaultsKey], `${label} defaults`);
  const limits = record(config[limitsKey], `${label} limits`);
  for (const key of keys) {
    const range = record(limits[key], `${label} ${key} range`);
    const min = number(range.min, `${label} ${key} minimum`, -100, 100);
    const max = number(range.max, `${label} ${key} maximum`, min, 100);
    number(defaults[key], `${label} ${key} default`, min, max);
  }
}

function validateGrass(configValue) {
  const config = record(configValue, 'Grass runtime configuration');
  validateRanges(config, 'defaults', 'limits', [
    'bladeLength', 'bladeWidth', 'bladeTaper', 'bladeBend', 'bladeCurvature',
    'clumpScale', 'clumpStrength', 'directionality', 'dryness', 'tipFade',
    'rootDarkening', 'heightJitter', 'widthJitter', 'leanJitter'
  ], 'Grass pattern');
  validateRanges(config, 'turfDefaults', 'turfLimits', [
    'fiberLength', 'fiberWidth', 'fiberBreakup', 'fiberSoftness'
  ], 'Turf pattern');
  const rendering = record(config.rendering, 'Grass rendering');
  for (const key of [
    'geometryDisplacementGain', 'triplanarAverageMix',
    'turfGeometryDisplacementGain', 'turfTriplanarAverageMix'
  ]) number(rendering[key], `Grass rendering ${key}`, 0, 1);
}

function validateCellular(configValue) {
  const config = record(configValue, 'Cellular runtime configuration');
  const section = (name) => record(config[name], `Cellular ${name}`);
  number(section('sampling').jitter, 'Cellular sampling jitter', 0, 0.95);
  number(section('warp').scale, 'Cellular warp scale', 0.01, 4);
  number(section('warp').strength, 'Cellular warp strength', 0, 2);
  const interior = section('interior');
  const low = number(interior.low, 'Cellular interior low', 0.001, 1);
  const high = number(interior.high, 'Cellular interior high', 0.002, 2);
  if (high <= low) throw new Error('Cellular interior high must exceed low.');
  number(section('boundary').compression, 'Cellular boundary compression', 0, 0.5);
  number(section('breakup').scale, 'Cellular breakup scale', 0.1, 8);
  number(section('breakup').strength, 'Cellular breakup strength', 0, 1);
  number(section('asymmetry').scale, 'Cellular asymmetry scale', 0.05, 4);
  number(section('asymmetry').strength, 'Cellular asymmetry strength', 0, 1);
  number(section('displacement').gain, 'Cellular displacement gain', 0, 1);
  const output = section('output');
  const floor = number(output.floor, 'Cellular output floor', 0, 1);
  const gain = number(output.gain, 'Cellular output gain', 0, 2);
  if (floor + gain > 1.25) throw new Error('Cellular output floor and gain exceed the supported range.');
}

function validateRendererSafety(configValue) {
  const config = record(configValue, 'Renderer safety runtime configuration');
  const displacement = record(config.displacement, 'Renderer displacement safety');
  const geometry = number(displacement.geometrySoftLimit, 'Geometry displacement soft limit', 0.001, 1);
  number(displacement.normalSoftLimit, 'Normal displacement soft limit', geometry, 1);
  const normal = record(config.normal, 'Renderer normal safety');
  number(normal.determinantEpsilon, 'Normal determinant epsilon', 1e-12, 0.01);
  number(normal.vectorEpsilon, 'Normal vector epsilon', 1e-12, 0.01);
  const zoom = record(config.zoom, 'Renderer zoom safety');
  number(zoom.response, 'Zoom response', 1, 60);
  number(zoom.wheelSensitivity, 'Zoom wheel sensitivity', 0.00001, 0.05);
  number(zoom.maxInputPixels, 'Zoom max input pixels', 1, 2000);
  number(zoom.settleDistance, 'Zoom settle distance', 0.000001, 0.1);
  number(zoom.linePixels, 'Zoom line pixels', 1, 100);
}

function validateStructuredPattern(configValue) {
  const config = record(configValue, 'Structured pattern runtime configuration');
  const projection = record(config.projection, 'Structured pattern projection');
  number(projection.sharpness, 'Structured pattern projection sharpness', 1, 16);
  number(projection.portableAverageMix, 'Structured pattern portable average mix', 0, 1);
  const gains = record(config.displacementGain, 'Structured pattern displacement gains');
  for (const kind of ['brick', 'tile', 'plank', 'pebble', 'roof-tile', 'fabric']) {
    number(gains[kind], `Structured pattern ${kind} displacement gain`, 0, 1);
  }
}

function validateTextureField(configValue) {
  const config = record(configValue, 'Texture field runtime configuration');
  const projection = record(config.projection, 'Texture field projection');
  number(projection.sharpness, 'Texture field projection sharpness', 1, 16);
  number(projection.minWeight, 'Texture field projection minimum weight', 0, 0.25);
  const sampling = record(config.sampling, 'Texture field sampling');
  number(sampling.maxAnisotropy, 'Texture field maximum anisotropy', 1, 16);
}

const values = Object.fromEntries(
  await Promise.all(Object.entries(sources).map(async ([key, source]) => [key, await load(source)]))
);

validateGrass(values.grass);
validateCellular(values.cellular);
validateRendererSafety(values.rendererSafety);
validateStructuredPattern(values.structuredPattern);
validateTextureField(values.textureField);

const generated = `// Generated by scripts/generate-runtime-config.mjs. Do not edit by hand.\n` +
  `// Runtime code imports these build-time values and never parses Lab YAML.\n\n` +
  `export const RUNTIME_GRASS_PATTERN_CONFIG = ${JSON.stringify(values.grass, null, 2)} as const;\n\n` +
  `export const RUNTIME_CELLULAR_CONFIG = ${JSON.stringify(values.cellular, null, 2)} as const;\n\n` +
  `export const RUNTIME_RENDERER_SAFETY_CONFIG = ${JSON.stringify(values.rendererSafety, null, 2)} as const;\n\n` +
  `export const RUNTIME_STRUCTURED_PATTERN_CONFIG = ${JSON.stringify(values.structuredPattern, null, 2)} as const;\n\n` +
  `export const RUNTIME_TEXTURE_FIELD_CONFIG = ${JSON.stringify(values.textureField, null, 2)} as const;\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== generated) {
    throw new Error('Generated runtime configuration is stale. Run npm run generate:runtime-config.');
  }
  console.log('Generated runtime configuration is current.');
} else {
  await mkdir(resolve(root, 'src/core/material/generated'), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  console.log(`Generated ${outputPath}.`);
}
