import { parse } from 'yaml';
import rawConfig from '../../config/cellular.yaml?raw';

export interface CellularConfig {
  sampling: {
    jitter: number;
  };
  warp: {
    scale: number;
    strength: number;
  };
  interior: {
    low: number;
    high: number;
  };
  boundary: {
    compression: number;
  };
  breakup: {
    scale: number;
    strength: number;
  };
  asymmetry: {
    scale: number;
    strength: number;
  };
  displacement: {
    gain: number;
  };
  output: {
    floor: number;
    gain: number;
  };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Cellular configuration section ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid cellular configuration value: ${name}.`);
  }
  return value;
}

function parseConfig(value: unknown): CellularConfig {
  const root = asRecord(value, 'root');
  const sampling = asRecord(root.sampling, 'sampling');
  const warp = asRecord(root.warp, 'warp');
  const interior = asRecord(root.interior, 'interior');
  const boundary = asRecord(root.boundary, 'boundary');
  const breakup = asRecord(root.breakup, 'breakup');
  const asymmetry = asRecord(root.asymmetry, 'asymmetry');
  const displacement = asRecord(root.displacement, 'displacement');
  const output = asRecord(root.output, 'output');

  const low = asNumber(interior.low, 'interior.low', 0.001, 1);
  const high = asNumber(interior.high, 'interior.high', 0.002, 2);
  if (high <= low) throw new Error('Cellular interior.high must be greater than interior.low.');

  const floor = asNumber(output.floor, 'output.floor', 0, 1);
  const gain = asNumber(output.gain, 'output.gain', 0, 2);
  if (floor + gain > 1.25) throw new Error('Cellular output floor and gain exceed the supported range.');

  return {
    sampling: {
      jitter: asNumber(sampling.jitter, 'sampling.jitter', 0, 0.95)
    },
    warp: {
      scale: asNumber(warp.scale, 'warp.scale', 0.01, 4),
      strength: asNumber(warp.strength, 'warp.strength', 0, 2)
    },
    interior: { low, high },
    boundary: {
      compression: asNumber(boundary.compression, 'boundary.compression', 0, 0.5)
    },
    breakup: {
      scale: asNumber(breakup.scale, 'breakup.scale', 0.1, 8),
      strength: asNumber(breakup.strength, 'breakup.strength', 0, 1)
    },
    asymmetry: {
      scale: asNumber(asymmetry.scale, 'asymmetry.scale', 0.05, 4),
      strength: asNumber(asymmetry.strength, 'asymmetry.strength', 0, 1)
    },
    displacement: {
      gain: asNumber(displacement.gain, 'displacement.gain', 0, 1)
    },
    output: { floor, gain }
  };
}

export const cellularConfig = parseConfig(parse(rawConfig) as unknown);

export function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
