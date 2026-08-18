import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ObjectPreset } from '../materials/types';

export function createProceduralMesh(
  preset: ObjectPreset,
  material: THREE.Material
): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  switch (preset) {
    case 'sphere':
      geometry = new THREE.SphereGeometry(1.18, 160, 112);
      break;
    case 'icosphere':
      geometry = new THREE.IcosahedronGeometry(1.2, 6);
      break;
    case 'cube':
      geometry = new THREE.BoxGeometry(1.9, 1.9, 1.9, 48, 48, 48);
      break;
    case 'rounded-cube':
      geometry = new RoundedBoxGeometry(1.9, 1.9, 1.9, 12, 0.2);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(0.82, 0.38, 96, 192);
      break;
    case 'plane':
      geometry = new THREE.PlaneGeometry(2.5, 2.5, 160, 160);
      break;
  }

  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (preset === 'plane') {
    mesh.rotation.x = -Math.PI * 0.16;
  }

  return mesh;
}
