import * as THREE from 'three';

interface UvTriangle {
  readonly index: number;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly cx: number;
  readonly cy: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const UV_EPSILON = 1e-5;
const UV_AREA_EPSILON = 1e-10;
const MIN_UV_OVERLAP_GRID_SIZE = 16;
const MAX_UV_OVERLAP_GRID_SIZE = 256;
const TRIANGLE_ATLAS_PADDING = 0.14;

function triangleVertexIndex(
  geometry: THREE.BufferGeometry,
  triangle: number,
  corner: number,
  vertexCount: number,
  meshName: string
): number {
  const index = geometry.getIndex();
  const value = index === null ? triangle * 3 + corner : index.getX(triangle * 3 + corner);
  if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
    throw new Error(`Mesh "${meshName}" contains an invalid triangle index.`);
  }
  return value;
}

function projectionRange(
  triangle: UvTriangle,
  axisX: number,
  axisY: number
): readonly [number, number] {
  const a = triangle.ax * axisX + triangle.ay * axisY;
  const b = triangle.bx * axisX + triangle.by * axisY;
  const c = triangle.cx * axisX + triangle.cy * axisY;
  return [Math.min(a, b, c), Math.max(a, b, c)];
}

function hasPositiveProjectionOverlap(
  first: UvTriangle,
  second: UvTriangle,
  edgeX: number,
  edgeY: number
): boolean {
  const axisLength = Math.hypot(edgeX, edgeY);
  if (axisLength <= UV_AREA_EPSILON) return false;
  const axisX = -edgeY / axisLength;
  const axisY = edgeX / axisLength;
  const firstRange = projectionRange(first, axisX, axisY);
  const secondRange = projectionRange(second, axisX, axisY);
  const overlap = Math.min(firstRange[1], secondRange[1]) - Math.max(firstRange[0], secondRange[0]);
  return overlap > UV_EPSILON;
}

function trianglesOverlapWithArea(first: UvTriangle, second: UvTriangle): boolean {
  if (
    Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) <= UV_EPSILON ||
    Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY) <= UV_EPSILON
  ) {
    return false;
  }

  const edges = [
    [first.bx - first.ax, first.by - first.ay],
    [first.cx - first.bx, first.cy - first.by],
    [first.ax - first.cx, first.ay - first.cy],
    [second.bx - second.ax, second.by - second.ay],
    [second.cx - second.bx, second.cy - second.by],
    [second.ax - second.cx, second.ay - second.cy]
  ] as const;

  return edges.every(([edgeX, edgeY]) => hasPositiveProjectionOverlap(first, second, edgeX, edgeY));
}

function createUvTriangles(geometry: THREE.BufferGeometry, meshName: string): UvTriangle[] {
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  if (uv === undefined || uv.count === 0) throw new Error(`Mesh "${meshName}" has no UV coordinates to bake into.`);
  if (position === undefined || position.count === 0 || uv.count !== position.count || uv.itemSize < 2) {
    throw new Error(`Mesh "${meshName}" has invalid UV or position attributes.`);
  }

  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    const u = uv.getX(vertex);
    const v = uv.getY(vertex);
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      throw new Error(`Mesh "${meshName}" contains non-finite UV coordinates.`);
    }
    if (u < -UV_EPSILON || u > 1 + UV_EPSILON || v < -UV_EPSILON || v > 1 + UV_EPSILON) {
      throw new Error(`Mesh "${meshName}" uses tiled or out-of-range UVs. Texture baking requires a unique 0–1 unwrap.`);
    }
  }

  const indexCount = geometry.getIndex()?.count ?? position.count;
  if (indexCount < 3 || indexCount % 3 !== 0) {
    throw new Error(`Mesh "${meshName}" does not contain a valid triangle list for texture baking.`);
  }

  const triangles: UvTriangle[] = [];
  for (let triangle = 0; triangle < indexCount / 3; triangle += 1) {
    const ia = triangleVertexIndex(geometry, triangle, 0, position.count, meshName);
    const ib = triangleVertexIndex(geometry, triangle, 1, position.count, meshName);
    const ic = triangleVertexIndex(geometry, triangle, 2, position.count, meshName);
    const ax = uv.getX(ia);
    const ay = uv.getY(ia);
    const bx = uv.getX(ib);
    const by = uv.getY(ib);
    const cx = uv.getX(ic);
    const cy = uv.getY(ic);
    const doubledArea = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (doubledArea <= UV_AREA_EPSILON) {
      throw new Error(`Mesh "${meshName}" contains a degenerate UV triangle. Texture baking requires a non-degenerate unique unwrap.`);
    }
    triangles.push({
      index: triangle,
      ax,
      ay,
      bx,
      by,
      cx,
      cy,
      minX: Math.min(ax, bx, cx),
      maxX: Math.max(ax, bx, cx),
      minY: Math.min(ay, by, cy),
      maxY: Math.max(ay, by, cy)
    });
  }
  return triangles;
}

export function validateBakeUv(geometry: THREE.BufferGeometry, meshName: string): void {
  const triangles = createUvTriangles(geometry, meshName);
  const gridSize = Math.min(
    MAX_UV_OVERLAP_GRID_SIZE,
    Math.max(MIN_UV_OVERLAP_GRID_SIZE, Math.ceil(Math.sqrt(triangles.length)))
  );
  const cells = new Map<number, number[]>();
  const testedPairs = new Set<number>();

  for (const triangle of triangles) {
    const minX = Math.max(0, Math.min(gridSize - 1, Math.floor(triangle.minX * gridSize)));
    const maxX = Math.max(0, Math.min(gridSize - 1, Math.floor(triangle.maxX * gridSize)));
    const minY = Math.max(0, Math.min(gridSize - 1, Math.floor(triangle.minY * gridSize)));
    const maxY = Math.max(0, Math.min(gridSize - 1, Math.floor(triangle.maxY * gridSize)));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const cellId = y * gridSize + x;
        const occupants = cells.get(cellId) ?? [];
        for (const previousIndex of occupants) {
          const pairId = previousIndex * triangles.length + triangle.index;
          if (testedPairs.has(pairId)) continue;
          testedPairs.add(pairId);
          const previous = triangles[previousIndex];
          if (previous !== undefined && trianglesOverlapWithArea(previous, triangle)) {
            throw new Error(`Mesh "${meshName}" contains overlapping or mirrored UV islands. Texture baking requires a unique unwrap.`);
          }
        }
        occupants.push(triangle.index);
        cells.set(cellId, occupants);
      }
    }
  }
}

export function createTriangleAtlas(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const atlas = source.getIndex() === null ? source.clone() : source.toNonIndexed();
  const position = atlas.getAttribute('position');
  if (position === undefined || position.count < 3 || position.count % 3 !== 0) {
    atlas.dispose();
    throw new Error('Cannot create an automatic UV atlas for geometry without a valid triangle list.');
  }

  const triangleCount = position.count / 3;
  const grid = Math.ceil(Math.sqrt(triangleCount));
  const cell = 1 / grid;
  const padding = TRIANGLE_ATLAS_PADDING * cell;
  const uvs = new Float32Array(position.count * 2);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const x = triangle % grid;
    const y = Math.floor(triangle / grid);
    const left = x * cell + padding;
    const right = (x + 1) * cell - padding;
    const bottom = y * cell + padding;
    const top = (y + 1) * cell - padding;
    const offset = triangle * 6;
    uvs[offset] = left;
    uvs[offset + 1] = bottom;
    uvs[offset + 2] = right;
    uvs[offset + 3] = bottom;
    uvs[offset + 4] = left;
    uvs[offset + 5] = top;
  }

  atlas.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  atlas.computeBoundingBox();
  atlas.computeBoundingSphere();
  return atlas;
}
