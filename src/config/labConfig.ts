import { parse } from 'yaml';
import rawConfig from '../../config/lab.yaml?raw';
import type { BlendMode, LayerKind, ObjectPreset, PhysicalSettings } from '../materials/types';

interface CatalogItem<T extends string> {
  id: T;
  label: string;
}

interface ObjectCatalogItem extends CatalogItem<ObjectPreset> {
  glyph: string;
}

interface RendererConfig {
  maxPixelRatio: number;
  cameraFov: number;
  cameraNear: number;
  cameraFar: number;
  cameraPosition: [number, number, number];
  minDistance: number;
  maxDistance: number;
  toneMappingExposure: number;
}

interface LabConfig {
  app: {
    name: string;
    storageKey: string;
    maxLayers: number;
    historyLimit: number;
    autosaveDelayMs: number;
  };
  defaults: {
    background: string;
    object: ObjectPreset;
    physical: PhysicalSettings;
  };
  objects: ObjectCatalogItem[];
  layerKinds: CatalogItem<LayerKind>[];
  blendModes: CatalogItem<BlendMode>[];
  renderer: RendererConfig;
}

function assertNumber(value: number, name: string, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Invalid configuration value: ${name}.`);
  }
}

function validate(config: LabConfig): LabConfig {
  if (config.app.name.trim().length === 0 || config.app.storageKey.trim().length === 0) {
    throw new Error('Application configuration requires a name and storage key.');
  }

  assertNumber(config.app.maxLayers, 'app.maxLayers', 1);
  assertNumber(config.app.historyLimit, 'app.historyLimit', 1);
  assertNumber(config.app.autosaveDelayMs, 'app.autosaveDelayMs', 0);
  assertNumber(config.renderer.maxPixelRatio, 'renderer.maxPixelRatio', 0.5);
  assertNumber(config.renderer.cameraFov, 'renderer.cameraFov', 1);
  assertNumber(config.renderer.cameraNear, 'renderer.cameraNear', 0.001);
  assertNumber(config.renderer.cameraFar, 'renderer.cameraFar', config.renderer.cameraNear);

  if (config.objects.length === 0 || config.layerKinds.length === 0 || config.blendModes.length === 0) {
    throw new Error('Configuration catalogs cannot be empty.');
  }

  return config;
}

export const labConfig = validate(parse(rawConfig) as LabConfig);
