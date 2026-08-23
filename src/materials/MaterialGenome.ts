import {
  PTL_LAYER_LIMITS,
  PTL_SYNTHESIS_LIMITS
} from '../core/material/runtimeDefaults';
import type { GenomeLocks, MaterialLayer, SynthesisSettings } from './types';

export interface MaterialGenome {
  seed: number;
  layers: MaterialLayer[];
  synthesis: SynthesisSettings;
}

function randomFactory(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mutateNumber(value: number, span: number, random: () => number): number {
  return value + (random() * 2 - 1) * span;
}

function mutateColor(color: string, random: () => number): string {
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255]
    .map((channel) => Math.round(clamp(mutateNumber(channel, 20, random), 0, 255)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function mutateGenome(
  layers: readonly MaterialLayer[],
  synthesis: Readonly<SynthesisSettings>,
  locks: Readonly<GenomeLocks>,
  mutationSeed: number,
  amount = 0.18
): MaterialGenome {
  const random = randomFactory(mutationSeed);
  const strength = clamp(amount, 0, 1);
  const nextLayers = layers.map((layer) => ({
    ...layer,
    seed: locks.structure
      ? layer.seed
      : clamp(
          Math.round(mutateNumber(layer.seed, 31 * strength, random)),
          PTL_LAYER_LIMITS.seed.min,
          PTL_LAYER_LIMITS.seed.max
        ),
    strength: locks.structure
      ? layer.strength
      : clamp(
          mutateNumber(layer.strength, 0.7 * strength, random),
          PTL_LAYER_LIMITS.strength.min,
          PTL_LAYER_LIMITS.strength.max
        ),
    scale: locks.scale
      ? layer.scale
      : clamp(
          layer.scale * (1 + (random() * 2 - 1) * strength),
          PTL_LAYER_LIMITS.scale.min,
          PTL_LAYER_LIMITS.scale.max
        ),
    roughness: locks.roughness
      ? layer.roughness
      : clamp(
          mutateNumber(layer.roughness, 0.35 * strength, random),
          PTL_LAYER_LIMITS.roughness.min,
          PTL_LAYER_LIMITS.roughness.max
        ),
    displacement: locks.damage
      ? layer.displacement
      : clamp(
          mutateNumber(layer.displacement, 0.09 * strength, random),
          PTL_LAYER_LIMITS.displacement.min,
          PTL_LAYER_LIMITS.displacement.max
        ),
    colorA: locks.color ? layer.colorA : mutateColor(layer.colorA, random),
    colorB: locks.color ? layer.colorB : mutateColor(layer.colorB, random)
  }));
  const nextSynthesis: SynthesisSettings = {
    ...synthesis,
    age: locks.damage
      ? synthesis.age
      : clamp(
          mutateNumber(synthesis.age, strength, random),
          PTL_SYNTHESIS_LIMITS.age.min,
          PTL_SYNTHESIS_LIMITS.age.max
        ),
    weathering: locks.damage
      ? synthesis.weathering
      : clamp(
          mutateNumber(synthesis.weathering, strength, random),
          PTL_SYNTHESIS_LIMITS.weathering.min,
          PTL_SYNTHESIS_LIMITS.weathering.max
        ),
    macro: locks.scale
      ? synthesis.macro
      : clamp(
          mutateNumber(synthesis.macro, strength, random),
          PTL_SYNTHESIS_LIMITS.macro.min,
          PTL_SYNTHESIS_LIMITS.macro.max
        ),
    meso: locks.scale
      ? synthesis.meso
      : clamp(
          mutateNumber(synthesis.meso, strength, random),
          PTL_SYNTHESIS_LIMITS.meso.min,
          PTL_SYNTHESIS_LIMITS.meso.max
        ),
    micro: locks.scale
      ? synthesis.micro
      : clamp(
          mutateNumber(synthesis.micro, strength, random),
          PTL_SYNTHESIS_LIMITS.micro.min,
          PTL_SYNTHESIS_LIMITS.micro.max
        ),
    variation: locks.structure
      ? synthesis.variation
      : clamp(
          mutateNumber(synthesis.variation, strength, random),
          PTL_SYNTHESIS_LIMITS.variation.min,
          PTL_SYNTHESIS_LIMITS.variation.max
        )
  };
  return { seed: mutationSeed, layers: nextLayers, synthesis: nextSynthesis };
}
