import type { LayerKind } from './RuntimeMaterial';

/**
 * Relief is the height profile of a material layer, normalized to 0..1 with high meaning
 * raised geometry, for every layer kind and either displacement sign. The height mask
 * thresholds this value, so a single convention is required across the base GLSL, portable
 * GLSL and TSL evaluators.
 *
 * Three rules define it:
 *
 * 1. The base signal is the shaped field. `labDisplacementSignal` returns `shaped` for
 *    zero-baseline kinds and `shaped - 0.5` for the rest; folding the latter back into 0..1
 *    is an offset of 0.5, which collapses to `shaped` in both cases.
 * 2. Coverage folds in only for zero-baseline kinds. There it means absence of material —
 *    the gap between bricks, the space between spots — and must read as relief 0. For dense
 *    field kinds it is a tint weight rather than geometry, and folding it in would bend the
 *    threshold non-linearly.
 * 3. A negative displacement means the layer is recessed, so its relief is mirrored. Zero
 *    displacement is treated as positive rather than flat, which keeps a layer authored
 *    purely for color usable as a mask source.
 */

/**
 * Kinds whose shaped field is already a zero-baseline height profile, where 0 means no
 * material rather than a trough. Mirrors the `kind == 4 || kind == 5 || kind == 7` test in
 * the base GLSL, plus `pattern` which only the portable and TSL evaluators know about.
 */
export const ZERO_BASELINE_LAYER_KINDS: ReadonlySet<LayerKind> = new Set<LayerKind>([
  'spots',
  'veins',
  'vessels',
  'pattern'
]);

export function isZeroBaselineLayerKind(kind: LayerKind): boolean {
  return ZERO_BASELINE_LAYER_KINDS.has(kind);
}

/** Lower bound on mask softness, keeping `smoothstep` off a degenerate edge pair. */
export const PTL_MASK_SOFTNESS_FLOOR = 0.001;

/** Domain scale for the noise that breaks up a height mask boundary. */
export const PTL_MASK_BREAKUP_SCALE = 7.3;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Reference mirror of `labLayerCoverage`, including the portable pattern specialization. */
export function materialLayerCoverage(kind: LayerKind, shaped: number): number {
  if (kind === 'base') return 1;
  if (kind === 'pattern') return smoothstep(0.04, 0.92, shaped);
  if (isZeroBaselineLayerKind(kind)) return smoothstep(0.03, 0.92, shaped);
  if (kind === 'ridges') return 0.24 + (1 - 0.24) * shaped;
  return 0.48 + (1 - 0.48) * shaped;
}

/**
 * Reference implementation of the relief convention. The GLSL evaluators are written to
 * match this; the TSL evaluators consume `isZeroBaselineLayerKind` directly.
 */
export function materialLayerRelief(
  kind: LayerKind,
  shaped: number,
  displacement: number
): number {
  const base = isZeroBaselineLayerKind(kind)
    ? shaped * materialLayerCoverage(kind, shaped)
    : shaped;
  const oriented = displacement < 0 ? 1 - base : base;
  return Math.min(Math.max(oriented, 0), 1);
}

/**
 * Shapes a relief value into a height mask. `relief` is expected to already carry any
 * breakup perturbation, which is noise-driven and therefore evaluator-local.
 */
export function materialHeightMask(
  relief: number,
  threshold: number,
  softness: number
): number {
  const width = Math.max(softness, PTL_MASK_SOFTNESS_FLOOR);
  const center = Math.min(Math.max(threshold, 0), 1);
  return smoothstep(center - width, center + width, relief);
}
