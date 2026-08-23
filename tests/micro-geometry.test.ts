import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tessellateForMicroGeometry } from '../src/export/MicroGeometry';

describe('micro geometry export', () => {
  it('tessellates within the configured vertex budget', () => {
    const source = new THREE.PlaneGeometry(2, 2, 1, 1);
    const result = tessellateForMicroGeometry(source, {
      enabled: true,
      maxEdgeLength: 0.4,
      iterations: 2,
      maxVertices: 5000
    });

    expect(result.getAttribute('position').count).toBeGreaterThan(source.getAttribute('position').count);
    expect(result.getAttribute('position').count).toBeLessThanOrEqual(5000);
    result.dispose();
    source.dispose();
  });

  it('falls back without mutating the source when disabled', () => {
    const source = new THREE.BoxGeometry(1, 1, 1);
    const result = tessellateForMicroGeometry(source, {
      enabled: false,
      maxEdgeLength: 0.08,
      iterations: 2,
      maxVertices: 250000
    });

    expect(result).not.toBe(source);
    expect(result.getAttribute('position').count).toBe(source.getAttribute('position').count);
    result.dispose();
    source.dispose();
  });
});
