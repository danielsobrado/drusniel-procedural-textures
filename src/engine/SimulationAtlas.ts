import * as THREE from 'three';
import type { MaterialAlgorithmSettings } from '../core/material/MaterialAlgorithms';
import {
  SIMULATION_ATLAS_COLUMNS,
  SIMULATION_ATLAS_ROWS
} from '../core/material/SimulationAtlasLayout';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import type { MaterialLayer } from '../materials/types';
import { MaterialComputeEngine } from './MaterialComputeEngine';

export interface MaterialSimulationAtlas {
  texture: THREE.DataTexture;
  readyLayers: boolean[];
  cellSize: number;
}

const ATLAS_PACK_YIELD_MIN_SIZE = 512;
const ATLAS_PACK_YIELD_ROWS = 16;

function simulationKind(layer: Readonly<MaterialLayer>): 'reaction-diffusion' | 'thermal-erosion' | null {
  if (!layer.enabled) return null;
  if (layer.kind === 'reaction-diffusion') return 'reaction-diffusion';
  if (layer.kind === 'erosion') return 'thermal-erosion';
  return null;
}

function waitForTask(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export function materialSimulationFingerprint(
  layers: readonly MaterialLayer[],
  algorithms: Readonly<MaterialAlgorithmSettings>
): string {
  const inputs = layers
    .slice(0, PTL_MAX_LAYERS)
    .map((layer, index) => ({ index, kind: simulationKind(layer), seed: layer.seed }))
    .filter((input): input is { index: number; kind: 'reaction-diffusion' | 'thermal-erosion'; seed: number } =>
      input.kind !== null
    );
  const usesReactionDiffusion = inputs.some((input) => input.kind === 'reaction-diffusion');
  const usesThermalErosion = inputs.some((input) => input.kind === 'thermal-erosion');
  return JSON.stringify({
    inputs,
    version: algorithms.version,
    simulationSize: algorithms.simulationSize,
    reactionDiffusion: usesReactionDiffusion ? algorithms.reactionDiffusion : null,
    thermalErosion: usesThermalErosion ? algorithms.thermalErosion : null
  });
}

export async function buildMaterialSimulationAtlas(
  engine: MaterialComputeEngine,
  layers: readonly MaterialLayer[],
  algorithms: Readonly<MaterialAlgorithmSettings>
): Promise<MaterialSimulationAtlas | null> {
  const simulationLayers = layers
    .slice(0, PTL_MAX_LAYERS)
    .map((layer, index) => ({ layer, index, kind: simulationKind(layer) }))
    .filter((item): item is { layer: MaterialLayer; index: number; kind: 'reaction-diffusion' | 'thermal-erosion' } =>
      item.kind !== null
    );

  if (simulationLayers.length === 0) return null;

  const cellSize = algorithms.simulationSize;
  const atlasWidth = cellSize * SIMULATION_ATLAS_COLUMNS;
  const atlasHeight = cellSize * SIMULATION_ATLAS_ROWS;
  const bytes = new Uint8Array(atlasWidth * atlasHeight);
  const readyLayers = new Array<boolean>(PTL_MAX_LAYERS).fill(false);

  for (const item of simulationLayers) {
    const field = await engine.simulate({
      kind: item.kind,
      size: cellSize,
      iterations: item.kind === 'reaction-diffusion'
        ? algorithms.reactionDiffusion.iterations
        : algorithms.thermalErosion.iterations,
      seed: Math.round(item.layer.seed * 1_000) + item.index * 104729,
      reactionDiffusion: algorithms.reactionDiffusion,
      erosionRate: algorithms.thermalErosion.rate
    });

    const column = item.index % SIMULATION_ATLAS_COLUMNS;
    const row = Math.floor(item.index / SIMULATION_ATLAS_COLUMNS);
    for (let y = 0; y < cellSize; y += 1) {
      const targetRow = row * cellSize + y;
      const targetOffset = targetRow * atlasWidth + column * cellSize;
      const sourceOffset = y * cellSize;
      for (let x = 0; x < cellSize; x += 1) {
        const value = field.values[sourceOffset + x] ?? 0;
        bytes[targetOffset + x] = Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
      }
      if (
        cellSize >= ATLAS_PACK_YIELD_MIN_SIZE &&
        y > 0 &&
        y % ATLAS_PACK_YIELD_ROWS === 0
      ) await waitForTask();
    }
    readyLayers[item.index] = true;
  }

  const texture = new THREE.DataTexture(
    bytes,
    atlasWidth,
    atlasHeight,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  texture.name = 'PTL Simulation Atlas';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture, readyLayers, cellSize };
}
