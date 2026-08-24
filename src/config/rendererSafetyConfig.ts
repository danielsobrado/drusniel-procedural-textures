import { parse } from 'yaml';
import rawConfig from '../../config/renderer-safety.yaml?raw';

export interface RendererSafetyConfig {
  displacement: {
    geometrySoftLimit: number;
    normalSoftLimit: number;
  };
  normal: {
    determinantEpsilon: number;
    vectorEpsilon: number;
  };
  zoom: {
    response: number;
    wheelSensitivity: number;
    maxInputPixels: number;
    settleDistance: number;
    linePixels: number;
  };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Configuration section ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid configuration value: ${name}.`);
  }
  return value;
}

function parseConfig(value: unknown): RendererSafetyConfig {
  const root = asRecord(value, 'renderer-safety');
  const displacement = asRecord(root.displacement, 'renderer-safety.displacement');
  const normal = asRecord(root.normal, 'renderer-safety.normal');
  const zoom = asRecord(root.zoom, 'renderer-safety.zoom');
  const geometrySoftLimit = asNumber(
    displacement.geometrySoftLimit,
    'renderer-safety.displacement.geometrySoftLimit',
    0.001,
    1
  );
  const normalSoftLimit = asNumber(
    displacement.normalSoftLimit,
    'renderer-safety.displacement.normalSoftLimit',
    geometrySoftLimit,
    1
  );

  return {
    displacement: {
      geometrySoftLimit,
      normalSoftLimit
    },
    normal: {
      determinantEpsilon: asNumber(
        normal.determinantEpsilon,
        'renderer-safety.normal.determinantEpsilon',
        1e-12,
        0.01
      ),
      vectorEpsilon: asNumber(
        normal.vectorEpsilon,
        'renderer-safety.normal.vectorEpsilon',
        1e-12,
        0.01
      )
    },
    zoom: {
      response: asNumber(zoom.response, 'renderer-safety.zoom.response', 1, 60),
      wheelSensitivity: asNumber(
        zoom.wheelSensitivity,
        'renderer-safety.zoom.wheelSensitivity',
        0.00001,
        0.05
      ),
      maxInputPixels: asNumber(
        zoom.maxInputPixels,
        'renderer-safety.zoom.maxInputPixels',
        1,
        2000
      ),
      settleDistance: asNumber(
        zoom.settleDistance,
        'renderer-safety.zoom.settleDistance',
        0.000001,
        0.1
      ),
      linePixels: asNumber(zoom.linePixels, 'renderer-safety.zoom.linePixels', 1, 100)
    }
  };
}

export const rendererSafetyConfig = parseConfig(parse(rawConfig) as unknown);
