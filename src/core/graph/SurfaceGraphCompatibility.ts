import type { SurfaceGraphValueType } from './SurfaceGraph';

const SCALAR_TYPES = new Set<SurfaceGraphValueType>(['float', 'mask', 'height']);

export function surfaceGraphPortTypesCompatible(
  source: SurfaceGraphValueType,
  target: SurfaceGraphValueType
): boolean {
  return source === target || (SCALAR_TYPES.has(source) && SCALAR_TYPES.has(target));
}

export function surfaceGraphOutputTypesCompatible(
  source: SurfaceGraphValueType,
  target: SurfaceGraphValueType
): boolean {
  return surfaceGraphPortTypesCompatible(source, target) ||
    (target === 'color' && SCALAR_TYPES.has(source));
}
