import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ObjectPreset } from '../materials/types';

const SPHERE_RADIUS = 1.18;
const SPHERE_WIDTH_SEGMENTS = 160;
const SPHERE_HEIGHT_SEGMENTS = 112;

const ICOSPHERE_RADIUS = 1.2;
const ICOSPHERE_DETAIL = 6;

const BOX_SIZE = 1.9;
const BOX_SEGMENTS = 48;
const BOX_MERGE_TOLERANCE = 1e-5;

const ROUNDED_BOX_SIZE = 1.9;
const ROUNDED_BOX_SEGMENTS = 32;
const ROUNDED_BOX_RADIUS = 0.2;
const ROUNDED_BOX_MERGE_TOLERANCE = 1e-5;

const TORUS_RADIUS = 0.82;
const TORUS_TUBE_RADIUS = 0.38;
const TORUS_RADIAL_SEGMENTS = 96;
const TORUS_TUBULAR_SEGMENTS = 192;

const PLANE_SIZE = 2.5;
const PLANE_SEGMENTS = 160;
const PLANE_TILT_X = -Math.PI * 0.16;

function weldGeometry(
  geometry: THREE.BufferGeometry,
  tolerance: number
): THREE.BufferGeometry {
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');

  const mergedGeometry = mergeVertices(geometry, tolerance);
  geometry.dispose();
  mergedGeometry.computeVertexNormals();

  return mergedGeometry;
}

function createClosedCubeGeometry(): THREE.BufferGeometry {
  return weldGeometry(new THREE.BoxGeometry(
    BOX_SIZE,
    BOX_SIZE,
    BOX_SIZE,
    BOX_SEGMENTS,
    BOX_SEGMENTS,
    BOX_SEGMENTS
  ), BOX_MERGE_TOLERANCE);
}

function createClosedRoundedCubeGeometry(): THREE.BufferGeometry {
  return weldGeometry(new RoundedBoxGeometry(
    ROUNDED_BOX_SIZE,
    ROUNDED_BOX_SIZE,
    ROUNDED_BOX_SIZE,
    ROUNDED_BOX_SEGMENTS,
    ROUNDED_BOX_RADIUS
  ), ROUNDED_BOX_MERGE_TOLERANCE);
}

export function createProceduralMesh(
  preset: ObjectPreset,
  material: THREE.Material
): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  switch (preset) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(
        SPHERE_RADIUS,
        SPHERE_WIDTH_SEGMENTS,
        SPHERE_HEIGHT_SEGMENTS
      );
      break;
    case 'icosphere':
      geometry = new THREE.IcosahedronGeometry(ICOSPHERE_RADIUS, ICOSPHERE_DETAIL);
      break;
    case 'cube':
      geometry = createClosedCubeGeometry();
      break;
    case 'rounded-cube':
      geometry = createClosedRoundedCubeGeometry();
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(
        TORUS_RADIUS,
        TORUS_TUBE_RADIUS,
        TORUS_RADIAL_SEGMENTS,
        TORUS_TUBULAR_SEGMENTS
      );
      break;
    case 'plane':
      geometry = new THREE.PlaneGeometry(
        PLANE_SIZE,
        PLANE_SIZE,
        PLANE_SEGMENTS,
        PLANE_SEGMENTS
      );
      break;
  }

  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.labProceduralPreview = true;
  mesh.userData.labObjectPreset = preset;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (preset === 'plane') {
    mesh.rotation.x = PLANE_TILT_X;
  }

  return mesh;
}
