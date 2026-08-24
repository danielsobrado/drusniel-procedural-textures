import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ObjectPreset } from '../materials/types';

const SPHERE_RADIUS = 1.18;
const SPHERE_WIDTH_SEGMENTS = 112;
const SPHERE_HEIGHT_SEGMENTS = 80;
const SPHERE_MERGE_TOLERANCE = 1e-5;

const ICOSPHERE_RADIUS = 1.2;
const ICOSPHERE_DETAIL = 5;
const ICOSPHERE_MERGE_TOLERANCE = 1e-5;

const BOX_SIZE = 1.9;
const BOX_SEGMENTS = 32;
const BOX_MERGE_TOLERANCE = 1e-5;

const ROUNDED_BOX_SIZE = 1.9;
const ROUNDED_BOX_SEGMENTS = 24;
const ROUNDED_BOX_RADIUS = 0.2;
const ROUNDED_BOX_MERGE_TOLERANCE = 1e-5;

const TORUS_RADIUS = 0.82;
const TORUS_TUBE_RADIUS = 0.38;
const TORUS_RADIAL_SEGMENTS = 72;
const TORUS_TUBULAR_SEGMENTS = 160;

const PLANE_SIZE = 2.5;
const PLANE_SEGMENTS = 128;
const PLANE_TILT_X = -Math.PI * 0.16;

const CYLINDER_RADIUS = 0.82;
const CYLINDER_HEIGHT = 2.0;
const CYLINDER_RADIAL_SEGMENTS = 96;
const CYLINDER_HEIGHT_SEGMENTS = 48;
const CYLINDER_MERGE_TOLERANCE = 1e-5;

const CONE_RADIUS = 0.96;
const CONE_HEIGHT = 2.05;
const CONE_RADIAL_SEGMENTS = 96;
const CONE_HEIGHT_SEGMENTS = 48;
const CONE_MERGE_TOLERANCE = 1e-5;

const CAPSULE_RADIUS = 0.64;
const CAPSULE_LENGTH = 1.12;
const CAPSULE_CAP_SEGMENTS = 32;
const CAPSULE_BODY_SEGMENTS = 48;
const CAPSULE_RADIAL_SEGMENTS = 96;
const CAPSULE_MERGE_TOLERANCE = 1e-5;

const OCTAHEDRON_RADIUS = 1.22;
const OCTAHEDRON_DETAIL = 2;
const OCTAHEDRON_MERGE_TOLERANCE = 1e-5;

const DODECAHEDRON_RADIUS = 1.16;
const DODECAHEDRON_DETAIL = 2;
const DODECAHEDRON_MERGE_TOLERANCE = 1e-5;

const TORUS_KNOT_RADIUS = 0.72;
const TORUS_KNOT_TUBE_RADIUS = 0.25;
const TORUS_KNOT_TUBULAR_SEGMENTS = 192;
const TORUS_KNOT_RADIAL_SEGMENTS = 40;
const TORUS_KNOT_P = 2;
const TORUS_KNOT_Q = 3;
const TORUS_KNOT_MERGE_TOLERANCE = 1e-5;

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

function createClosedSphereGeometry(): THREE.BufferGeometry {
  return weldGeometry(new THREE.SphereGeometry(
    SPHERE_RADIUS,
    SPHERE_WIDTH_SEGMENTS,
    SPHERE_HEIGHT_SEGMENTS
  ), SPHERE_MERGE_TOLERANCE);
}

function createClosedIcosphereGeometry(): THREE.BufferGeometry {
  return weldGeometry(
    new THREE.IcosahedronGeometry(ICOSPHERE_RADIUS, ICOSPHERE_DETAIL),
    ICOSPHERE_MERGE_TOLERANCE
  );
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

function createClosedCylinderGeometry(): THREE.BufferGeometry {
  return weldGeometry(new THREE.CylinderGeometry(
    CYLINDER_RADIUS,
    CYLINDER_RADIUS,
    CYLINDER_HEIGHT,
    CYLINDER_RADIAL_SEGMENTS,
    CYLINDER_HEIGHT_SEGMENTS,
    false
  ), CYLINDER_MERGE_TOLERANCE);
}

function createClosedConeGeometry(): THREE.BufferGeometry {
  return weldGeometry(new THREE.ConeGeometry(
    CONE_RADIUS,
    CONE_HEIGHT,
    CONE_RADIAL_SEGMENTS,
    CONE_HEIGHT_SEGMENTS,
    false
  ), CONE_MERGE_TOLERANCE);
}

function createCapsuleProfile(): THREE.Vector2[] {
  const profile: THREE.Vector2[] = [];
  const halfLength = CAPSULE_LENGTH * 0.5;

  for (let index = 0; index <= CAPSULE_CAP_SEGMENTS; index += 1) {
    const angle = -Math.PI * 0.5 + (Math.PI * 0.5 * index) / CAPSULE_CAP_SEGMENTS;
    profile.push(new THREE.Vector2(
      Math.cos(angle) * CAPSULE_RADIUS,
      -halfLength + Math.sin(angle) * CAPSULE_RADIUS
    ));
  }

  for (let index = 1; index <= CAPSULE_BODY_SEGMENTS; index += 1) {
    const amount = index / CAPSULE_BODY_SEGMENTS;
    profile.push(new THREE.Vector2(
      CAPSULE_RADIUS,
      THREE.MathUtils.lerp(-halfLength, halfLength, amount)
    ));
  }

  for (let index = 1; index <= CAPSULE_CAP_SEGMENTS; index += 1) {
    const angle = (Math.PI * 0.5 * index) / CAPSULE_CAP_SEGMENTS;
    profile.push(new THREE.Vector2(
      Math.cos(angle) * CAPSULE_RADIUS,
      halfLength + Math.sin(angle) * CAPSULE_RADIUS
    ));
  }

  return profile;
}

function createClosedCapsuleGeometry(): THREE.BufferGeometry {
  return weldGeometry(
    new THREE.LatheGeometry(createCapsuleProfile(), CAPSULE_RADIAL_SEGMENTS),
    CAPSULE_MERGE_TOLERANCE
  );
}

function createClosedOctahedronGeometry(): THREE.BufferGeometry {
  return weldGeometry(
    new THREE.OctahedronGeometry(OCTAHEDRON_RADIUS, OCTAHEDRON_DETAIL),
    OCTAHEDRON_MERGE_TOLERANCE
  );
}

function createClosedDodecahedronGeometry(): THREE.BufferGeometry {
  return weldGeometry(
    new THREE.DodecahedronGeometry(DODECAHEDRON_RADIUS, DODECAHEDRON_DETAIL),
    DODECAHEDRON_MERGE_TOLERANCE
  );
}

function createClosedTorusKnotGeometry(): THREE.BufferGeometry {
  return weldGeometry(new THREE.TorusKnotGeometry(
    TORUS_KNOT_RADIUS,
    TORUS_KNOT_TUBE_RADIUS,
    TORUS_KNOT_TUBULAR_SEGMENTS,
    TORUS_KNOT_RADIAL_SEGMENTS,
    TORUS_KNOT_P,
    TORUS_KNOT_Q
  ), TORUS_KNOT_MERGE_TOLERANCE);
}

/**
 * Welded geometry templates, keyed by preset.
 *
 * The first build for a detailed primitive can be expensive, so preview tessellation is
 * intentionally bounded and the finished geometry is cached. A clone is essential:
 * replaceRoot() disposes the geometry it swaps out and must never dispose the template.
 */
const geometryTemplates = new Map<ObjectPreset, THREE.BufferGeometry>();

function templateGeometry(preset: ObjectPreset, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let template = geometryTemplates.get(preset);
  if (template === undefined) {
    template = build();
    geometryTemplates.set(preset, template);
  }
  return template.clone();
}

export function createProceduralMesh(
  preset: ObjectPreset,
  material: THREE.Material
): THREE.Mesh {
  const geometry = templateGeometry(preset, () => buildPresetGeometry(preset));

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

function buildPresetGeometry(preset: ObjectPreset): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;

  switch (preset) {
    case 'sphere':
      geometry = createClosedSphereGeometry();
      break;
    case 'icosphere':
      geometry = createClosedIcosphereGeometry();
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
    case 'cylinder':
      geometry = createClosedCylinderGeometry();
      break;
    case 'cone':
      geometry = createClosedConeGeometry();
      break;
    case 'capsule':
      geometry = createClosedCapsuleGeometry();
      break;
    case 'octahedron':
      geometry = createClosedOctahedronGeometry();
      break;
    case 'dodecahedron':
      geometry = createClosedDodecahedronGeometry();
      break;
    case 'torus-knot':
      geometry = createClosedTorusKnotGeometry();
      break;
  }

  return geometry;
}
