import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_BACKGROUND, DEFAULT_ENVIRONMENT, RENDERER_CONFIG } from '../app/constants';
import type { EnvironmentPreset, ObjectPreset } from '../materials/types';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { createProceduralMesh } from './MeshFactory';
import { EnvironmentLibrary, type StudioLightProfile } from './EnvironmentLibrary';
import {
  collectMeshMaterials,
  collectNonMeshMaterials,
  disposeMaterialResources,
  disposeObjectResources
} from './ObjectResources';

type MeshMaterial = THREE.Material | THREE.Material[];

function materialSet(material: MeshMaterial): Set<THREE.Material> {
  return new Set(Array.isArray(material) ? material : [material]);
}

export class LabRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(
    RENDERER_CONFIG.cameraFov,
    1,
    RENDERER_CONFIG.cameraNear,
    RENDERER_CONFIG.cameraFar
  );
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly compiler: MaterialCompiler;
  private readonly environments: EnvironmentLibrary;
  private readonly hemisphere = new THREE.HemisphereLight('#edf4ff', '#231d1a', 1.2);
  private readonly key = new THREE.DirectionalLight('#fff3e4', 3.1);
  private readonly fill = new THREE.DirectionalLight('#b8d5ff', 1.15);
  private readonly rim = new THREE.DirectionalLight('#ffb18f', 1.35);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionBox = new THREE.Box3();
  private readonly selectionHelper = new THREE.Box3Helper(this.selectionBox, 0x8d9dff);
  private readonly interactionAbort = new AbortController();

  private currentRoot: THREE.Object3D | null = null;
  private readonly meshById = new Map<string, THREE.Mesh>();
  private readonly originalMeshMaterials = new Map<string, MeshMaterial>();
  private selectedMeshId: string | null = null;
  private meshSelectionCallback: ((id: string | null) => void) | null = null;
  private animationFrame = 0;

  public constructor(container: HTMLElement, compiler: MaterialCompiler) {
    this.compiler = compiler;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'lab-canvas';
    container.append(this.canvas);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(DEFAULT_BACKGROUND);

    this.environments = new EnvironmentLibrary(this.renderer);
    this.camera.position.fromArray(RENDERER_CONFIG.cameraPosition);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = true;
    this.controls.minDistance = RENDERER_CONFIG.minDistance;
    this.controls.maxDistance = RENDERER_CONFIG.maxDistance;

    this.addStudioLighting();
    this.setEnvironment(DEFAULT_ENVIRONMENT);
    this.selectionHelper.visible = false;
    this.scene.add(this.selectionHelper);
    this.bindMeshPicking();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.start();
  }

  public setMeshSelectionCallback(callback: (id: string | null) => void): void {
    this.meshSelectionCallback = callback;
  }

  public setPrimitive(preset: ObjectPreset): void {
    const mesh = createProceduralMesh(preset, this.compiler.material);
    this.applyProceduralMeshSettings(mesh);
    this.replaceRoot(mesh, new Map(), new Map());
  }

  public setImported(root: THREE.Object3D, assignments: Readonly<Record<string, boolean>> = {}): void {
    const originals = new Map<string, MeshMaterial>();
    const meshes = new Map<string, THREE.Mesh>();

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (
        object.geometry.getAttribute('position') !== undefined &&
        object.geometry.getAttribute('normal') === undefined
      ) {
        object.geometry.computeVertexNormals();
      }
      const id = object.userData.labMeshId;
      if (typeof id !== 'string') return;
      originals.set(id, object.material);
      meshes.set(id, object);
    });

    this.replaceRoot(root, originals, meshes);
    this.setMeshAssignments(assignments);
  }

  public setMeshAssignments(assignments: Readonly<Record<string, boolean>>): void {
    for (const [id, mesh] of this.meshById) {
      const assigned = assignments[id] ?? true;
      if (assigned) {
        mesh.material = this.compiler.material;
        this.applyProceduralMeshSettings(mesh);
      } else {
        const original = this.originalMeshMaterials.get(id);
        if (original !== undefined) mesh.material = original;
        mesh.customDepthMaterial = undefined;
        mesh.customDistanceMaterial = undefined;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
      }
    }
  }

  public setSelectedMesh(id: string | null): void {
    this.selectedMeshId = id !== null && this.meshById.has(id) ? id : null;
    const mesh = this.selectedMeshId === null ? null : this.meshById.get(this.selectedMeshId) ?? null;
    if (mesh === null) {
      this.selectionHelper.visible = false;
      return;
    }
    this.selectionBox.setFromObject(mesh);
    this.selectionHelper.visible = !this.selectionBox.isEmpty();
  }

  public setEnvironment(preset: EnvironmentPreset, customName: string | null = null): void {
    const profile = this.environments.apply(this.scene, preset, customName);
    this.applyLightProfile(profile);
  }

  public async loadEnvironmentHdr(file: File): Promise<void> {
    await this.environments.loadHdr(file);
  }

  public setBackground(color: string): void {
    this.scene.background = new THREE.Color(color);
  }

  public frameSelection(): void {
    const selected = this.selectedMeshId === null ? null : this.meshById.get(this.selectedMeshId) ?? null;
    const target = selected ?? this.currentRoot;
    if (target === null) return;

    const bounds = new THREE.Box3().setFromObject(target);
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius + this.compiler.displacementExtent, 0.1);
    const verticalHalfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const horizontalHalfFov = Math.atan(
      Math.tan(verticalHalfFov) * Math.max(this.camera.aspect, 0.001)
    );
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
    const distance = (radius / Math.tan(limitingHalfFov)) * 1.28;
    const direction = this.camera.position.clone().sub(this.controls.target);
    direction.lengthSq() < 1e-8 ? direction.set(0, 0, 1) : direction.normalize();

    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 100, 0.01);
    this.camera.far = Math.max(distance * 20, 50);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  public resetView(): void {
    this.camera.position.fromArray(RENDERER_CONFIG.cameraPosition);
    this.controls.target.set(0, 0, 0);
    this.camera.near = RENDERER_CONFIG.cameraNear;
    this.camera.far = RENDERER_CONFIG.cameraFar;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.frameSelection();
  }

  public capturePng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.interactionAbort.abort();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeCurrentRoot();
    this.scene.remove(this.selectionHelper);
    this.selectionHelper.dispose();
    this.environments.dispose();
    this.compiler.dispose();
    this.renderer.dispose();
  }

  private applyProceduralMeshSettings(mesh: THREE.Mesh): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = this.compiler.depthMaterial;
    mesh.customDistanceMaterial = this.compiler.distanceMaterial;
  }

  private addStudioLighting(): void {
    this.scene.add(this.hemisphere);
    this.key.position.set(-3.5, 4.2, 4.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 0.1;
    this.key.shadow.camera.far = 15;
    this.key.shadow.bias = -0.0002;
    this.scene.add(this.key);
    this.fill.position.set(4, 1.5, 2.5);
    this.scene.add(this.fill);
    this.rim.position.set(-2.5, -1, -4);
    this.scene.add(this.rim);
  }

  private applyLightProfile(profile: StudioLightProfile): void {
    this.key.color.set(profile.keyColor);
    this.key.intensity = profile.keyIntensity;
    this.fill.color.set(profile.fillColor);
    this.fill.intensity = profile.fillIntensity;
    this.rim.color.set(profile.rimColor);
    this.rim.intensity = profile.rimIntensity;
    this.hemisphere.intensity = profile.hemisphereIntensity;
  }

  private replaceRoot(
    root: THREE.Object3D,
    originals: Map<string, MeshMaterial>,
    meshes: Map<string, THREE.Mesh>
  ): void {
    this.disposeCurrentRoot();
    this.currentRoot = root;
    this.originalMeshMaterials.clear();
    originals.forEach((material, id) => this.originalMeshMaterials.set(id, material));
    this.meshById.clear();
    meshes.forEach((mesh, id) => this.meshById.set(id, mesh));
    this.selectedMeshId = null;
    this.selectionHelper.visible = false;
    this.scene.add(root);
    this.frameSelection();
  }

  private disposeCurrentRoot(): void {
    const root = this.currentRoot;
    if (root === null) return;

    const visibleMeshMaterials = collectMeshMaterials(root);
    const retainedNonMesh = collectNonMeshMaterials(root);
    const hiddenOriginals = new Set<THREE.Material>();
    for (const material of this.originalMeshMaterials.values()) {
      for (const item of materialSet(material)) {
        if (!visibleMeshMaterials.has(item)) hiddenOriginals.add(item);
      }
    }
    disposeMaterialResources(hiddenOriginals, new Set([...visibleMeshMaterials, ...retainedNonMesh]));

    this.scene.remove(root);
    disposeObjectResources(root, new Set([this.compiler.material]));
    this.currentRoot = null;
    this.originalMeshMaterials.clear();
    this.meshById.clear();
    this.selectedMeshId = null;
    this.selectionHelper.visible = false;
  }

  private bindMeshPicking(): void {
    let pointerStart: { x: number; y: number; id: number } | null = null;
    const signal = this.interactionAbort.signal;

    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, { signal });

    this.canvas.addEventListener('pointerup', (event) => {
      if (pointerStart === null || pointerStart.id !== event.pointerId || event.button !== 0) {
        pointerStart = null;
        return;
      }
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      pointerStart = null;
      if (moved > 5 || this.meshById.size === 0) return;

      const rect = this.canvas.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
        -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects([...this.meshById.values()], false)[0]?.object;
      const id = hit instanceof THREE.Mesh && typeof hit.userData.labMeshId === 'string'
        ? hit.userData.labMeshId
        : null;
      this.meshSelectionCallback?.(id);
    }, { signal });

    this.canvas.addEventListener('pointercancel', () => { pointerStart = null; }, { signal });
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (parent === null) return;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio, RENDERER_CONFIG.maxPixelRatio);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private start(): void {
    const render = (): void => {
      this.animationFrame = requestAnimationFrame(render);
      this.controls.update();
      if (this.selectionHelper.visible && this.selectedMeshId !== null) {
        const mesh = this.meshById.get(this.selectedMeshId);
        if (mesh !== undefined) this.selectionBox.setFromObject(mesh);
      }
      this.renderer.render(this.scene, this.camera);
    };
    render();
  }
}
