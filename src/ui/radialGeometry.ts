/**
 * Shared polar maths for radial menus. Extracted from `RadialMenu` rather than copied: the
 * material picker needs a generalised form (variable ring size, paging, its own radius), and
 * two copies of the edge-clamping would inevitably be fixed in only one of them.
 */

/** Keeps a menu centred on a pointer fully on screen without moving it more than needed. */
export function safeCenter(position: number, extent: number, margin: number): number {
  const center = extent / 2;
  const minimum = Math.min(margin, center);
  const maximum = Math.max(extent - margin, center);
  return Math.max(minimum, Math.min(maximum, position));
}

/** Evenly spaced slot on a ring, starting at twelve o'clock and running clockwise. */
export function ringSlotPosition(
  index: number,
  count: number,
  radius: number,
  startAngle = -Math.PI / 2
): { x: number; y: number } {
  if (count <= 0) return { x: 0, y: 0 };
  const angle = startAngle + (index / count) * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}
