import * as THREE from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import type { MicroGeometrySettings } from '../core/material/MicroGeometry';

function positionCount(geometry: THREE.BufferGeometry): number {
  return geometry.getAttribute('position')?.count ?? 0;
}

function estimatedVertexCount(sourceCount: number, iterations: number): number {
  return sourceCount * 4 ** iterations;
}

export function tessellateForMicroGeometry(
  source: THREE.BufferGeometry,
  settings: Readonly<MicroGeometrySettings>
): THREE.BufferGeometry {
  if (!settings.enabled || settings.iterations <= 0) return source.clone();

  const sourceCount = positionCount(source);
  for (let iterations = settings.iterations; iterations > 0; iterations -= 1) {
    if (estimatedVertexCount(sourceCount, iterations) > settings.maxVertices * 2) continue;

    const input = source.clone();
    const modifier = new TessellateModifier(settings.maxEdgeLength, iterations);
    const candidate = modifier.modify(input);
    if (candidate !== input) input.dispose();

    if (positionCount(candidate) <= settings.maxVertices) {
      candidate.computeVertexNormals();
      candidate.deleteAttribute('tangent');
      candidate.computeBoundingBox();
      candidate.computeBoundingSphere();
      return candidate;
    }
    candidate.dispose();
  }

  return source.clone();
}
