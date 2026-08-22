import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const SUPPORTED_TILE_CHANNELS = new Set([
  'albedo',
  'roughness',
  'normal',
  'height',
  'clearcoat',
  'clearcoatRoughness'
]);

const SUPPORTED_OBJECTS = new Set([
  'sphere',
  'icosphere',
  'cube',
  'rounded-cube',
  'torus',
  'plane'
]);

const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/u;

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function token(value, label) {
  const text = string(value, label);
  if (!SAFE_TOKEN.test(text)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return text;
}

function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function list(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique values.`);
  }
}

function validateNaturalPreset(value, index) {
  const preset = record(value, `naturalPresets[${index}]`);
  const previewObjectId = token(preset.previewObjectId, `naturalPresets[${index}].previewObjectId`);
  if (!SUPPORTED_OBJECTS.has(previewObjectId)) {
    throw new Error(`naturalPresets[${index}].previewObjectId is unsupported: ${previewObjectId}.`);
  }

  return {
    id: token(preset.id, `naturalPresets[${index}].id`),
    name: string(preset.name, `naturalPresets[${index}].name`),
    category: token(preset.category, `naturalPresets[${index}].category`),
    fileStem: token(preset.fileStem, `naturalPresets[${index}].fileStem`),
    previewObjectId,
    previewObjectName: string(preset.previewObjectName, `naturalPresets[${index}].previewObjectName`),
    notes: string(preset.notes, `naturalPresets[${index}].notes`)
  };
}

export async function loadQaConfig(root) {
  const filePath = resolve(root, 'config/qa.yaml');
  const parsed = parse(await readFile(filePath, 'utf8'));
  const config = record(parsed, 'QA configuration');
  const server = record(config.server, 'server');
  const timeouts = record(config.timeouts, 'timeouts');
  const viewport = record(config.viewport, 'viewport');
  const tile = record(config.tile, 'tile');

  const suiteVersion = string(config.suiteVersion, 'suiteVersion');
  if (!SEMVER.test(suiteVersion)) {
    throw new Error('suiteVersion must use semantic version format x.y.z.');
  }

  const channels = list(tile.channels, 'tile.channels').map((channel, index) => {
    const id = token(channel, `tile.channels[${index}]`);
    if (!SUPPORTED_TILE_CHANNELS.has(id)) {
      throw new Error(`tile.channels[${index}] is unsupported: ${id}.`);
    }
    return id;
  });
  unique(channels, 'tile.channels');
  if (
    channels.length !== SUPPORTED_TILE_CHANNELS.size ||
    [...SUPPORTED_TILE_CHANNELS].some((channel) => !channels.includes(channel))
  ) {
    throw new Error('tile.channels must include every exported PBR channel exactly once.');
  }

  const naturalPresets = list(config.naturalPresets, 'naturalPresets').map(validateNaturalPreset);
  unique(naturalPresets.map((preset) => preset.id), 'naturalPresets ids');
  unique(naturalPresets.map((preset) => preset.fileStem), 'naturalPresets file stems');

  return {
    suiteVersion,
    outputDir: token(config.outputDir, 'outputDir'),
    server: {
      host: string(server.host, 'server.host'),
      port: integer(server.port, 'server.port', 1, 65535)
    },
    timeouts: {
      startMs: integer(timeouts.startMs, 'timeouts.startMs', 1000, 300000),
      uiMs: integer(timeouts.uiMs, 'timeouts.uiMs', 1000, 300000),
      viewportSettleMs: integer(timeouts.viewportSettleMs, 'timeouts.viewportSettleMs', 0, 10000),
      tileSettleMs: integer(timeouts.tileSettleMs, 'timeouts.tileSettleMs', 0, 10000)
    },
    viewport: {
      width: integer(viewport.width, 'viewport.width', 320, 7680),
      height: integer(viewport.height, 'viewport.height', 240, 4320)
    },
    tile: {
      previewCount: integer(tile.previewCount, 'tile.previewCount', 2, 5),
      channels
    },
    naturalPresets
  };
}
