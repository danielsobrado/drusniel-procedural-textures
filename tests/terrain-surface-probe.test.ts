import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTerrainMaterialMasks } from '../src/tile/TerrainMaterialMasks';
import { sampleTerrainHeight } from '../src/tile/TerrainPlayerController';
import {
  marchTerrainRay,
  sampleTerrainMaterialAt,
  terrainFieldIndexAt
} from '../src/tile/TerrainSurfaceProbe';
import type { TerrainFields, TerrainPaintMask } from '../src/tile/TerrainTypes';

const SIZE = 4;
const TERRAIN_SIZE = 10;
const TERRAIN_HEIGHT = 1.25;

function fieldsOf(material: number[], height?: number[], river?: number[]): TerrainFields {
  const count = SIZE * SIZE;
  return {
    resolution: SIZE,
    height: Float32Array.from(height ?? new Array<number>(count).fill(0)),
    slope: new Float32Array(count),
    flow: new Float32Array(count),
    river: Float32Array.from(river ?? new Array<number>(count).fill(0)),
    wetness: new Float32Array(count),
    material: Uint8Array.from(material),
    backend: 'cpu'
  };
}

function emptyPaint(): TerrainPaintMask {
  const count = SIZE * SIZE;
  return {
    material: new Uint8Array(count).fill(255),
    weight: new Float32Array(count)
  };
}

describe('terrain surface probe', () => {
  it('agrees with sampleTerrainHeight on where v = 0 lands', () => {
    // The mask DataTexture is flipY, the plane is rotated -90 on X, and height sampling wraps
    // the same way. If these three ever disagree the picker targets the wrong material.
    const fields = fieldsOf(new Array<number>(SIZE * SIZE).fill(0));
    const index = terrainFieldIndexAt(fields, -TERRAIN_SIZE / 2, -TERRAIN_SIZE / 2, TERRAIN_SIZE);
    expect(index).toBe(0);
  });

  it('wraps toroidally so a neighbouring tile resolves to the same cell', () => {
    const fields = fieldsOf(new Array<number>(SIZE * SIZE).fill(0));
    const inside = terrainFieldIndexAt(fields, 1.5, -2.5, TERRAIN_SIZE);
    const wrapped = terrainFieldIndexAt(fields, 1.5 + TERRAIN_SIZE, -2.5 - TERRAIN_SIZE, TERRAIN_SIZE);
    expect(wrapped).toBe(inside);
  });

  it('applies the same override rule as the mask builder', () => {
    const material = new Array<number>(SIZE * SIZE).fill(1);
    const fields = fieldsOf(material);
    const paint = emptyPaint();
    // A weak stroke loses to the automatic classification; a strong one wins.
    paint.material[0] = 4;
    paint.weight[0] = 0.2;
    paint.material[1] = 4;
    paint.weight[1] = 0.9;

    const masks = buildTerrainMaterialMasks(fields, paint);
    expect(masks.base[1]?.[0]).toBe(255);
    expect(masks.override[4]?.[1]).toBeGreaterThan(127);

    const weak = sampleTerrainMaterialAt(fields, paint, -5, -5, TERRAIN_SIZE, TERRAIN_HEIGHT);
    expect(weak.overridden).toBe(false);
    expect(weak.material).toBe('rock');

    const strong = sampleTerrainMaterialAt(fields, paint, -2.5, -5, TERRAIN_SIZE, TERRAIN_HEIGHT);
    expect(strong.overridden).toBe(true);
    expect(strong.material).toBe('current');
    // The classification underneath stays assignable, so the picker still has a target.
    expect(strong.base).toBe('rock');
  });

  it('never reports an unassignable slot as the base material', () => {
    const fields = fieldsOf(new Array<number>(SIZE * SIZE).fill(0));
    const paint = emptyPaint();
    paint.material[0] = 5;
    paint.weight[0] = 1;
    const hit = sampleTerrainMaterialAt(fields, paint, -5, -5, TERRAIN_SIZE, TERRAIN_HEIGHT);
    expect(hit.material).toBe('custom');
    expect(['grass', 'rock', 'mud', 'snow']).toContain(hit.base);
  });

  it('marches a ray to the same surface height that sampling reports', () => {
    const height = new Array<number>(SIZE * SIZE).fill(0.5);
    const fields = fieldsOf(new Array<number>(SIZE * SIZE).fill(0), height);
    const origin = new THREE.Vector3(0, TERRAIN_HEIGHT, 0);
    const direction = new THREE.Vector3(0.6, -0.8, 0).normalize();
    const hit = marchTerrainRay(fields, origin, direction, TERRAIN_SIZE, TERRAIN_HEIGHT, 8);
    expect(hit).not.toBeNull();
    const ground = sampleTerrainHeight(fields, hit!.x, hit!.z, TERRAIN_SIZE, TERRAIN_HEIGHT);
    expect(hit!.y).toBeCloseTo(ground, 2);
  });

  it('returns null when the ray never meets the ground', () => {
    const fields = fieldsOf(new Array<number>(SIZE * SIZE).fill(0));
    const skyward = marchTerrainRay(
      fields,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 1, 0),
      TERRAIN_SIZE,
      TERRAIN_HEIGHT,
      8
    );
    expect(skyward).toBeNull();
  });
});

describe('terrain inspection wiring', () => {
  const PREVIEW = readFileSync(
    new URL('../src/tile/TerrainMeshPreview.ts', import.meta.url),
    'utf8'
  );
  const PROPS = readFileSync(
    new URL('../src/tile/TerrainGameProps.ts', import.meta.url),
    'utf8'
  );
  const REFERENCE = readFileSync(
    new URL('../src/tile/TerrainScaleReference.ts', import.meta.url),
    'utf8'
  );
  const PANEL = readFileSync(
    new URL('../src/ui/TerrainTileLabPanel.ts', import.meta.url),
    'utf8'
  );

  it('orbits a movable pivot rather than always the origin', () => {
    expect(PREVIEW).toContain('this.camera.lookAt(this.orbitTarget)');
    expect(PREVIEW).toContain('public focusOrbitOn');
    expect(PREVIEW).toContain("addEventListener('dblclick'");
    // The pivot must reset when the terrain under it is replaced.
    expect(PREVIEW).toContain('this.resetOrbitTarget();');
  });

  it('stands the scale figure beside the pivot, not on it', () => {
    expect(REFERENCE).toContain('FIGURE_OFFSET_METERS');
    expect(REFERENCE).toContain('this.figure.position.x = metersToUnits(FIGURE_OFFSET_METERS');
  });

  it('keeps the diagnostic views reachable in 3D', () => {
    expect(PANEL).toContain("this.viewSelect.disabled = false;");
    expect(PANEL).toContain("this.mapCanvas.classList.toggle('is-inset', mode === '3d')");
    expect(PANEL).toContain('data-role="terrain-inspect"');
    expect(PREVIEW).toContain('public inspectSurface');
  });

  it('shows a minimap camera marker and reports both feet and reticle materials', () => {
    expect(PANEL).toContain('drawMapMarker');
    expect(PREVIEW).toContain('public getMapMarker');
    expect(PREVIEW).toContain('marchTerrainRay(');
    expect(PREVIEW).toContain('Feet:');
    expect(PREVIEW).toContain('Aim:');
  });

  it('scatters props by mask and re-scatters when the terrain changes', () => {
    expect(PROPS).toContain('MATERIAL_AFFINITY');
    expect(PROPS).toContain('RIVER_LIMIT');
    expect(PROPS).toContain('public updateForFields');
    expect(PREVIEW).toContain('this.gameProps.updateForFields(fields)');
    // Identical tiles are what makes the toroidal wrap seamless.
    expect(PROPS).toContain('mulberry32(0x50544c31)');
  });

  it('builds house geometry once and reuses it across density rebuilds', () => {
    expect(PROPS).toContain('houseTemplates');
    expect(PROPS).toContain('this.houseTemplates[index]!.clone(true)');
  });
});
