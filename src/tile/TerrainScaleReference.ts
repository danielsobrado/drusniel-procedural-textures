import * as THREE from 'three';
import { sampleTerrainHeight } from './TerrainPlayerController';
import { metersToUnits } from './TerrainScale';
import type { TerrainFields } from './TerrainTypes';

const FIGURE_HEIGHT_METERS = 1.75;
const FIGURE_RADIUS_METERS = 0.22;
const GRID_EXTENT_METERS = 20;
/**
 * The figure stands beside the pivot, not on it. At inspection distance a 1.75 m body
 * centred on the point you are examining fills the frame and hides the very texture you
 * zoomed in to judge.
 */
const FIGURE_OFFSET_METERS = 1.2;
/** Below this the figure earns its place; further out it is a speck. */
const FIGURE_VISIBLE_METERS = 60;
const GRID_VISIBLE_METERS = 20;

/**
 * A known-size human and a one-metre grid at the orbit pivot.
 *
 * Without something of known size in frame, "is this texture the right scale" has no answer
 * at all: a 4 m stone and a 40 cm stone look identical on an untextured hillside. The figure
 * also casts a shadow, which is the clearest single cue that the sun is doing its job.
 */
export class TerrainScaleReference {
  private readonly group = new THREE.Group();
  private readonly figure = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly coarseGrid: THREE.GridHelper;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private enabled = false;
  private distanceMeters = Number.POSITIVE_INFINITY;

  public constructor(scene: THREE.Scene, private readonly terrainSize: number) {
    this.group.name = 'PTL scale reference';
    this.group.visible = false;

    // Neutral grey so it reads as a ruler and never competes with the material under test.
    this.material = new THREE.MeshStandardMaterial({ color: 0x666a70, roughness: 0.82 });

    // Proportioned so the parts stack to exactly FIGURE_HEIGHT_METERS with the head clear
    // of the shoulders. A capsule whose cap swallows the head just reads as a pill.
    const headRadiusMeters = 0.115;
    const bodyLengthMeters =
      FIGURE_HEIGHT_METERS - headRadiusMeters * 2 - FIGURE_RADIUS_METERS * 2;
    const radius = metersToUnits(FIGURE_RADIUS_METERS, terrainSize);
    const headRadius = metersToUnits(headRadiusMeters, terrainSize);
    const body = new THREE.CapsuleGeometry(radius, metersToUnits(bodyLengthMeters, terrainSize), 4, 12);
    const head = new THREE.SphereGeometry(headRadius, 16, 12);
    this.geometries.push(body, head);

    this.figure.position.x = metersToUnits(FIGURE_OFFSET_METERS, terrainSize);
    const bodyMesh = new THREE.Mesh(body, this.material);
    bodyMesh.position.y = metersToUnits(
      FIGURE_RADIUS_METERS + bodyLengthMeters * 0.5,
      terrainSize
    );
    const headMesh = new THREE.Mesh(head, this.material);
    headMesh.position.y = metersToUnits(FIGURE_HEIGHT_METERS - headRadiusMeters, terrainSize);
    for (const mesh of [bodyMesh, headMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.figure.add(mesh);
    }
    this.group.add(this.figure);

    const extent = metersToUnits(GRID_EXTENT_METERS, terrainSize);
    this.grid = new THREE.GridHelper(extent, GRID_EXTENT_METERS, 0x8ea0c4, 0x55617a);
    this.coarseGrid = new THREE.GridHelper(extent, GRID_EXTENT_METERS / 5, 0xc7d4ef, 0xc7d4ef);
    for (const grid of [this.grid, this.coarseGrid]) {
      const material = grid.material as THREE.Material;
      material.transparent = true;
      material.depthWrite = false;
      grid.position.y = metersToUnits(0.02, terrainSize);
      this.group.add(grid);
    }
    (this.grid.material as THREE.Material).opacity = 0.28;
    (this.coarseGrid.material as THREE.Material).opacity = 0.4;

    scene.add(this.group);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncVisibility();
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  /** Follows the orbit pivot, snapped to the ground so it never floats or sinks. */
  public update(
    target: THREE.Vector3,
    fields: Readonly<TerrainFields> | null,
    terrainHeight: number,
    distanceMeters: number
  ): void {
    this.distanceMeters = distanceMeters;
    const ground = fields === null
      ? target.y
      : sampleTerrainHeight(fields, target.x, target.z, this.terrainSize, terrainHeight);
    this.group.position.set(target.x, ground, target.z);
    this.syncVisibility();
  }

  public dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.grid.dispose();
    this.coarseGrid.dispose();
  }

  /**
   * Derived from distance rather than exposed as a mode, so there is no state to forget you
   * are in: the figure appears as you approach human scale and the grid as you get closer.
   */
  private syncVisibility(): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    this.figure.visible = this.distanceMeters <= FIGURE_VISIBLE_METERS;
    const showGrid = this.distanceMeters <= GRID_VISIBLE_METERS;
    this.grid.visible = showGrid;
    this.coarseGrid.visible = showGrid;
  }
}
