export type MaterialCoordinateSpace = 'object' | 'world';

export function normalizeMaterialCoordinateSpace(value: unknown): MaterialCoordinateSpace {
  if (value === undefined) return 'world';
  if (value !== 'object' && value !== 'world') {
    throw new Error(`Unsupported material coordinate space: ${String(value)}.`);
  }
  return value;
}
