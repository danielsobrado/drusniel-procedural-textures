import {
  terrainMaterialIndex,
  type TerrainBrushStroke,
  type TerrainMaterialId,
  type TerrainPaintMask
} from './TerrainTypes';

const NO_MATERIAL = 255;
const BRUSH_SPACING_RATIO = 0.35;
const ERASE_EPSILON = 0.001;

function wrapDistance(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function wrapIndex(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function shortestWrappedDelta(from: number, to: number): number {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;
  return delta;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function affectedIndices(center: number, radius: number, size: number): number[] {
  const start = Math.floor((center - radius) * size - 0.5);
  const end = Math.ceil((center + radius) * size - 0.5);
  const result: number[] = [];
  const seen = new Set<number>();
  for (let index = start; index <= end; index += 1) {
    const wrapped = wrapIndex(index, size);
    if (seen.has(wrapped)) continue;
    seen.add(wrapped);
    result.push(wrapped);
  }
  return result;
}

export class TerrainPainter {
  private readonly strokeList: TerrainBrushStroke[] = [];
  private resolutionValue: number;
  private materialMask: Uint8Array;
  private weightMask: Float32Array;

  public constructor(resolution: number) {
    this.resolutionValue = resolution;
    this.materialMask = new Uint8Array(resolution * resolution);
    this.materialMask.fill(NO_MATERIAL);
    this.weightMask = new Float32Array(resolution * resolution);
  }

  public get strokes(): readonly TerrainBrushStroke[] {
    return this.strokeList;
  }

  public get mask(): TerrainPaintMask {
    return { material: this.materialMask, weight: this.weightMask };
  }

  public resize(resolution: number): void {
    if (resolution === this.resolutionValue) return;
    this.resolutionValue = resolution;
    this.rebuild();
  }

  public paint(
    material: TerrainMaterialId,
    x: number,
    y: number,
    radius: number,
    hardness: number,
    strength: number,
    erase = false
  ): void {
    const stroke: TerrainBrushStroke = {
      material,
      x: wrap01(x),
      y: wrap01(y),
      radius: Math.max(0.001, Math.min(0.5, radius)),
      hardness: clamp01(hardness),
      strength: clamp01(strength),
      erase
    };
    this.strokeList.push(stroke);
    this.apply(stroke);
  }

  public paintLine(
    material: TerrainMaterialId,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
    hardness: number,
    strength: number,
    erase = false
  ): void {
    const startX = wrap01(fromX);
    const startY = wrap01(fromY);
    const endX = wrap01(toX);
    const endY = wrap01(toY);
    const dx = shortestWrappedDelta(startX, endX);
    const dy = shortestWrappedDelta(startY, endY);
    const distance = Math.hypot(dx, dy);
    const spacing = Math.max(1 / this.resolutionValue, radius * BRUSH_SPACING_RATIO);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      this.paint(
        material,
        wrap01(startX + dx * t),
        wrap01(startY + dy * t),
        radius,
        hardness,
        strength,
        erase
      );
    }
  }

  public clear(): void {
    this.strokeList.length = 0;
    this.materialMask.fill(NO_MATERIAL);
    this.weightMask.fill(0);
  }

  public replaceStrokes(strokes: readonly TerrainBrushStroke[]): void {
    this.strokeList.length = 0;
    this.strokeList.push(...strokes.map((stroke) => ({ ...stroke })));
    this.rebuild();
  }

  private rebuild(): void {
    this.materialMask = new Uint8Array(this.resolutionValue * this.resolutionValue);
    this.materialMask.fill(NO_MATERIAL);
    this.weightMask = new Float32Array(this.resolutionValue * this.resolutionValue);
    for (const stroke of this.strokeList) this.apply(stroke);
  }

  private apply(stroke: Readonly<TerrainBrushStroke>): void {
    const size = this.resolutionValue;
    const materialIndex = terrainMaterialIndex(stroke.material);
    const innerRadius = stroke.radius * stroke.hardness;
    const xIndices = affectedIndices(stroke.x, stroke.radius, size);
    const yIndices = affectedIndices(stroke.y, stroke.radius, size);

    for (const y of yIndices) {
      const normalizedY = (y + 0.5) / size;
      const dy = wrapDistance(normalizedY, stroke.y);
      if (dy > stroke.radius) continue;
      for (const x of xIndices) {
        const normalizedX = (x + 0.5) / size;
        const dx = wrapDistance(normalizedX, stroke.x);
        const distance = Math.hypot(dx, dy);
        if (distance > stroke.radius) continue;
        const falloff = distance <= innerRadius
          ? 1
          : 1 - (distance - innerRadius) / Math.max(1e-6, stroke.radius - innerRadius);
        const index = y * size + x;
        const influence = clamp01(falloff * stroke.strength);
        if (stroke.erase) {
          this.weightMask[index] = Math.max(0, (this.weightMask[index] ?? 0) - influence);
          if ((this.weightMask[index] ?? 0) <= ERASE_EPSILON) this.materialMask[index] = NO_MATERIAL;
          continue;
        }

        if (this.materialMask[index] !== materialIndex) {
          this.materialMask[index] = materialIndex;
          this.weightMask[index] = influence;
        } else {
          this.weightMask[index] = Math.max(this.weightMask[index] ?? 0, influence);
        }
      }
    }
  }
}
