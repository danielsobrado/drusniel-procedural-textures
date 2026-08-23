export const PTL_ALGORITHM_VERSION = 1;

export interface ReactionDiffusionAlgorithm {
  iterations: number;
  feed: number;
  kill: number;
  diffusionA: number;
  diffusionB: number;
}

export interface ThermalErosionAlgorithm {
  iterations: number;
  rate: number;
}

export interface SdfAlgorithm {
  radius: number;
  boxSize: number;
  edgeSoftness: number;
}

export interface MaterialAlgorithmSettings {
  version: typeof PTL_ALGORITHM_VERSION;
  simulationSize: number;
  reactionDiffusion: ReactionDiffusionAlgorithm;
  thermalErosion: ThermalErosionAlgorithm;
  sdf: SdfAlgorithm;
}

export const DEFAULT_MATERIAL_ALGORITHMS: Readonly<MaterialAlgorithmSettings> = {
  version: PTL_ALGORITHM_VERSION,
  simulationSize: 128,
  reactionDiffusion: {
    iterations: 64,
    feed: 0.055,
    kill: 0.062,
    diffusionA: 0.18,
    diffusionB: 0.09
  },
  thermalErosion: {
    iterations: 64,
    rate: 0.22
  },
  sdf: {
    radius: 0.31,
    boxSize: 0.25,
    edgeSoftness: 0.06
  }
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function normalizeMaterialAlgorithms(value: unknown): MaterialAlgorithmSettings {
  const root = value === undefined
    ? DEFAULT_MATERIAL_ALGORITHMS
    : asRecord(value, 'Material algorithms');
  const version = root.version ?? DEFAULT_MATERIAL_ALGORITHMS.version;
  if (version !== PTL_ALGORITHM_VERSION) {
    throw new Error(`Unsupported material algorithm version: ${String(version)}.`);
  }

  const reactionInput = root.reactionDiffusion === undefined
    ? DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion
    : asRecord(root.reactionDiffusion, 'Reaction diffusion algorithm');
  const erosionInput = root.thermalErosion === undefined
    ? DEFAULT_MATERIAL_ALGORITHMS.thermalErosion
    : asRecord(root.thermalErosion, 'Thermal erosion algorithm');
  const sdfInput = root.sdf === undefined
    ? DEFAULT_MATERIAL_ALGORITHMS.sdf
    : asRecord(root.sdf, 'SDF algorithm');

  return {
    version: PTL_ALGORITHM_VERSION,
    simulationSize: integer(
      root.simulationSize ?? DEFAULT_MATERIAL_ALGORITHMS.simulationSize,
      'Simulation size',
      16,
      1024
    ),
    reactionDiffusion: {
      iterations: integer(
        reactionInput.iterations ?? DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion.iterations,
        'Reaction diffusion iterations',
        1,
        4096
      ),
      feed: finite(
        reactionInput.feed ?? DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion.feed,
        'Reaction diffusion feed',
        0,
        0.2
      ),
      kill: finite(
        reactionInput.kill ?? DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion.kill,
        'Reaction diffusion kill',
        0,
        0.2
      ),
      diffusionA: finite(
        reactionInput.diffusionA ?? DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion.diffusionA,
        'Reaction diffusion A',
        0,
        1
      ),
      diffusionB: finite(
        reactionInput.diffusionB ?? DEFAULT_MATERIAL_ALGORITHMS.reactionDiffusion.diffusionB,
        'Reaction diffusion B',
        0,
        1
      )
    },
    thermalErosion: {
      iterations: integer(
        erosionInput.iterations ?? DEFAULT_MATERIAL_ALGORITHMS.thermalErosion.iterations,
        'Thermal erosion iterations',
        1,
        4096
      ),
      rate: finite(
        erosionInput.rate ?? DEFAULT_MATERIAL_ALGORITHMS.thermalErosion.rate,
        'Thermal erosion rate',
        0,
        1
      )
    },
    sdf: {
      radius: finite(sdfInput.radius ?? DEFAULT_MATERIAL_ALGORITHMS.sdf.radius, 'SDF radius', 0.01, 0.49),
      boxSize: finite(sdfInput.boxSize ?? DEFAULT_MATERIAL_ALGORITHMS.sdf.boxSize, 'SDF box size', 0.01, 0.49),
      edgeSoftness: finite(
        sdfInput.edgeSoftness ?? DEFAULT_MATERIAL_ALGORITHMS.sdf.edgeSoftness,
        'SDF edge softness',
        0.001,
        0.25
      )
    }
  };
}
