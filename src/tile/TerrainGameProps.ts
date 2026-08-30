import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { sampleTerrainHeight } from './TerrainPlayerController';
import { metersToUnits } from './TerrainScale';
import { terrainFieldIndexAt } from './TerrainSurfaceProbe';
import type { TerrainFields } from './TerrainTypes';

interface PropAnchor {
  object: THREE.Object3D;
  x: number;
  z: number;
}

interface PropTile {
  group: THREE.Group;
  tileX: number;
  tileZ: number;
  anchors: PropAnchor[];
}

interface LoadedProp {
  root: THREE.Object3D;
  materialIndex: number;
  heightMeters: number;
}

/** Placement radius as a fraction of the tile, so props cover ground instead of huddling. */
const SCATTER_MIN = 0.05;
const SCATTER_MAX = 0.3;
const RIVER_LIMIT = 0.15;
const MAX_PLACEMENT_ATTEMPTS = 24;

/** Base material indices each model is willing to stand on. */
const MATERIAL_AFFINITY: Readonly<Record<number, readonly number[]>> = {
  // Plants want soil and grass, never bare rock or snow.
  0: [0, 2],
  // Rock props sit anywhere that is not river.
  1: [0, 1, 2, 3]
};

const MODEL_SPECS: ReadonlyArray<{
  file: string;
  materialIndex: number;
  heightMeters: number;
}> = [
  { file: 'rock-large.glb', materialIndex: 1, heightMeters: 1.8 },
  { file: 'rock-small.glb', materialIndex: 1, heightMeters: 0.75 },
  { file: 'bush.glb', materialIndex: 0, heightMeters: 1.35 },
  { file: 'plant.glb', materialIndex: 0, heightMeters: 0.9 },
  { file: 'tree-small.glb', materialIndex: 0, heightMeters: 5.5 }
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Face uv spans of a `BoxGeometry`, in metres, in three.js face order (+x -x +y -y +z -z).
 */
function boxFaceSpans(
  widthMeters: number,
  heightMeters: number,
  depthMeters: number
): ReadonlyArray<readonly [number, number]> {
  return [
    [depthMeters, heightMeters],
    [depthMeters, heightMeters],
    [widthMeters, depthMeters],
    [widthMeters, depthMeters],
    [widthMeters, heightMeters],
    [widthMeters, heightMeters]
  ];
}

/**
 * Rewrites the unit-square box uvs so one uv unit spans `referenceMeters`. Without this a
 * wall and the ground beneath it resolve at different texel densities and the building
 * reads as flat plastic however good the material is.
 */
function applyMetricBoxUv(
  geometry: THREE.BoxGeometry,
  widthMeters: number,
  heightMeters: number,
  depthMeters: number,
  referenceMeters: number
): void {
  const uv = geometry.attributes.uv;
  if (!(uv instanceof THREE.BufferAttribute)) return;
  const spans = boxFaceSpans(widthMeters, heightMeters, depthMeters);
  for (const [face, span] of spans.entries()) {
    for (let corner = 0; corner < 4; corner += 1) {
      const vertex = face * 4 + corner;
      uv.setXY(
        vertex,
        uv.getX(vertex) * span[0] / referenceMeters,
        uv.getY(vertex) * span[1] / referenceMeters
      );
    }
  }
  uv.needsUpdate = true;
}

function replaceMaterials(root: THREE.Object3D, material: THREE.Material): void {
  const discarded = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const originals = Array.isArray(object.material) ? object.material : [object.material];
    for (const original of originals) discarded.add(original);
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  for (const original of discarded) original.dispose();
}

function normalizeHeight(root: THREE.Object3D, targetHeight: number): void {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 1e-6);
  root.scale.setScalar(scale);
  const scaledBounds = new THREE.Box3().setFromObject(root);
  root.position.y -= scaledBounds.min.y;
}

/** Seeded, lightweight game-context props. Geometry comes from local CC0 GLBs. */
export class TerrainGameProps {
  private readonly loader = new GLTFLoader();
  private readonly tiles: PropTile[] = [];
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly houseTemplates: readonly THREE.Group[];
  private loaded: readonly LoadedProp[] = [];
  private density = 1;
  private visible = true;
  private repeated = false;
  private disposed = false;
  private fields: Readonly<TerrainFields> | null = null;

  public constructor(
    private readonly scene: THREE.Scene,
    private readonly materials: readonly THREE.Material[],
    private readonly tileRadius: number,
    private readonly terrainSize: number,
    private readonly terrainHeight: number,
    private readonly onReady: () => void
  ) {
    // Templates own the only procedural house geometries. Every rebuild/tile clones their
    // Object3D hierarchy while sharing those buffers, so density scrubbing cannot leak GPU
    // geometry.
    this.houseTemplates = [this.createHouse(0), this.createHouse(1)];
    void this.load();
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.syncVisibility();
  }

  public setRepeatedVisible(repeated: boolean): void {
    this.repeated = repeated;
    this.syncVisibility();
  }

  public setDensity(density: number): void {
    if (!Number.isFinite(density) || density < 0 || density === this.density) return;
    this.density = density;
    this.rebuild();
  }

  /**
   * Re-scatters as well as re-snapping heights. Only fixing Y left props at stale X/Z from a
   * previous terrain, which is how plants ended up standing in rivers and on cliffs.
   */
  public updateForFields(fields: Readonly<TerrainFields>): void {
    this.fields = fields;
    this.rebuild();
  }

  private rebuild(): void {
    if (this.disposed || this.loaded.length === 0) return;
    for (const tile of this.tiles) this.scene.remove(tile.group);
    this.tiles.length = 0;
    this.createTiles(this.loaded);
    if (this.fields !== null) {
      for (const tile of this.tiles) this.updateTileHeights(tile, this.fields);
    }
    this.syncVisibility();
  }

  public dispose(): void {
    this.disposed = true;
    for (const tile of this.tiles) this.scene.remove(tile.group);
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.ownedGeometries.clear();
    this.tiles.length = 0;
  }

  private async load(): Promise<void> {
    try {
      const loaded = await Promise.all(MODEL_SPECS.map(async (spec): Promise<LoadedProp> => {
        const gltf = await this.loader.loadAsync(
          `${import.meta.env.BASE_URL}models/cc0/${encodeURIComponent(spec.file)}`
        );
        replaceMaterials(gltf.scene, this.materials[spec.materialIndex]!);
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) this.ownedGeometries.add(object.geometry);
        });
        normalizeHeight(gltf.scene, metersToUnits(spec.heightMeters, this.terrainSize));
        const root = new THREE.Group();
        root.add(gltf.scene);
        return { root, materialIndex: spec.materialIndex, heightMeters: spec.heightMeters };
      }));
      if (this.disposed) {
        for (const geometry of this.ownedGeometries) geometry.dispose();
        this.ownedGeometries.clear();
        return;
      }
      this.loaded = loaded;
      this.rebuild();
      this.onReady();
    } catch (error) {
      console.warn('CC0 terrain scene samples could not be loaded.', error);
    }
  }

  private createTiles(loaded: readonly LoadedProp[]): void {
    for (let tileZ = -this.tileRadius; tileZ <= this.tileRadius; tileZ += 1) {
      for (let tileX = -this.tileRadius; tileX <= this.tileRadius; tileX += 1) {
        const group = new THREE.Group();
        group.name = 'Seeded CC0 terrain samples';
        group.position.set(tileX * this.terrainSize, 0, tileZ * this.terrainSize);
        const anchors = this.populateTile(group, loaded);
        this.tiles.push({ group, tileX, tileZ, anchors });
        this.scene.add(group);
      }
    }
  }

  /**
   * Rejection-samples a spot the model is willing to stand on. The attempt cap keeps the
   * count deterministic and the loop terminating even when a terrain offers no good ground:
   * the last candidate is accepted regardless.
   */
  private samplePlacement(
    random: () => number,
    materialIndex: number
  ): { x: number; z: number } {
    const affinity = MATERIAL_AFFINITY[materialIndex] ?? [0, 1, 2, 3];
    let candidate = { x: 0, z: 0 };
    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const radius = this.terrainSize * (SCATTER_MIN + random() * (SCATTER_MAX - SCATTER_MIN));
      candidate = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
      const fields = this.fields;
      if (fields === null) return candidate;
      const index = terrainFieldIndexAt(fields, candidate.x, candidate.z, this.terrainSize);
      if ((fields.river[index] ?? 0) > RIVER_LIMIT) continue;
      if (affinity.includes(fields.material[index] ?? 0)) return candidate;
    }
    return candidate;
  }

  private populateTile(group: THREE.Group, loaded: readonly LoadedProp[]): PropAnchor[] {
    // Re-seeded per tile on purpose: every tile has to be identical for the toroidal wrap in
    // player mode to be seamless.
    const random = mulberry32(0x50544c31);
    const anchors: PropAnchor[] = [];
    // Scaled with the scatter area. Widening the ring from 15-82 m to 25-154 m without
    // raising these left roughly one prop per 6,500 m2, so eye level saw empty ground.
    const counts = [10, 12, 10, 15, 8];
    for (const [modelIndex, model] of loaded.entries()) {
      const count = Math.max(0, Math.round((counts[modelIndex] ?? 4) * this.density));
      for (let instance = 0; instance < count; instance += 1) {
        const object = model.root.clone(true);
        const { x, z } = this.samplePlacement(random, model.materialIndex);
        object.position.x += x;
        object.position.z += z;
        object.rotation.y = random() * Math.PI * 2;
        const variation = 0.78 + random() * 0.46;
        object.scale.multiplyScalar(variation);
        group.add(object);
        anchors.push({ object, x, z });
      }
    }

    for (let index = 0; index < 2; index += 1) {
      const { x, z } = this.samplePlacement(random, 1);
      const angle = Math.atan2(z, x);
      const house = this.houseTemplates[index]!.clone(true);
      house.position.set(x, 0, z);
      house.rotation.y = angle + Math.PI * 0.3;
      group.add(house);
      anchors.push({ object: house, x, z });
    }
    return anchors;
  }

  private createHouse(variant: number): THREE.Group {
    const house = new THREE.Group();
    house.name = 'Simple game-scale house';
    const reference = TERRAIN_CONFIG.scale.propReferenceMeters;
    const widthMeters = variant === 0 ? 7 : 5.5;
    const depthMeters = variant === 0 ? 5 : 4.5;
    const wallHeightMeters = 3.2;
    const foundationHeightMeters = 0.35;
    const width = metersToUnits(widthMeters, this.terrainSize);
    const depth = metersToUnits(depthMeters, this.terrainSize);
    const wallHeight = metersToUnits(wallHeightMeters, this.terrainSize);
    const foundationHeight = metersToUnits(foundationHeightMeters, this.terrainSize);
    const foundationGeometry = new THREE.BoxGeometry(width * 1.08, foundationHeight, depth * 1.08);
    const wallGeometry = new THREE.BoxGeometry(width, wallHeight, depth);
    const roofGeometry = new THREE.ConeGeometry(width * 0.72, metersToUnits(2.1, this.terrainSize), 4);
    applyMetricBoxUv(
      foundationGeometry,
      widthMeters * 1.08,
      foundationHeightMeters,
      depthMeters * 1.08,
      reference
    );
    applyMetricBoxUv(wallGeometry, widthMeters, wallHeightMeters, depthMeters, reference);
    this.ownedGeometries.add(foundationGeometry);
    this.ownedGeometries.add(wallGeometry);
    this.ownedGeometries.add(roofGeometry);

    const foundation = new THREE.Mesh(foundationGeometry, this.materials[1]);
    foundation.position.y = foundationHeight * 0.5;
    const walls = new THREE.Mesh(wallGeometry, this.materials[variant === 0 ? 1 : 2]);
    walls.position.y = foundationHeight + wallHeight * 0.5;
    const roof = new THREE.Mesh(roofGeometry, this.materials[variant === 0 ? 3 : 2]);
    roof.position.y = foundationHeight + wallHeight + metersToUnits(0.9, this.terrainSize);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = depth / width;
    for (const mesh of [foundation, walls, roof]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      house.add(mesh);
    }
    return house;
  }

  private updateTileHeights(tile: PropTile, fields: Readonly<TerrainFields>): void {
    for (const anchor of tile.anchors) {
      anchor.object.position.y = sampleTerrainHeight(
        fields,
        anchor.x,
        anchor.z,
        this.terrainSize,
        this.terrainHeight
      ) + metersToUnits(0.05, this.terrainSize);
    }
  }

  private syncVisibility(): void {
    for (const tile of this.tiles) {
      const center = tile.tileX === 0 && tile.tileZ === 0;
      tile.group.visible = this.visible && (this.repeated || center);
    }
  }
}
