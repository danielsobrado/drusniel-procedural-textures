import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGLRenderer } from 'three';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PHYSICAL,
  PERFORMANCE_CONFIG,
  RENDERER_CONFIG,
  UI_CONFIG
} from '../app/constants';
import { GlbExporter } from '../export/GlbExporter';
import { PresetThumbnailRenderer } from '../export/PresetThumbnailRenderer';
import { TextureBaker, type BakedTextureSet } from '../export/TextureBaker';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type {
  EnvironmentPreset,
  MaterialPreset,
  ObjectPreset,
  PhysicalSettings
} from '../materials/types';
import { EnvironmentLibrary, type StudioLightProfile } from './EnvironmentLibrary';
import { createProceduralMesh } from './MeshFactory';
import {
  collectMeshMaterials,
  collectNonMeshMaterials,
  disposeMaterialResources,
  disposeObjectResources
} from './ObjectResources';
import { PerformanceProfiler } from './PerformanceProfiler';
import type {
  FixedQualityTier,
  PerformanceStats,
  QualityTier,
  QualityTierSettings
} from './Quality';

type MeshMaterial = THREE.Material | THREE.Material[];
type MaterialCompileStage = 'queued' | 'compiling' | 'retaining';

interface OriginalMeshState {
  material: MeshMaterial;
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
  customDepthMaterial: THREE.Material | undefined;
  customDistanceMaterial: THREE.Material | undefined;
}

interface MaterialCompileFailure {
  materialVersion: number;
  sceneRevision: number;
  error: Error;
}

interface MaterialProgramVariant {
  key: string;
  sheen: boolean;
  transmission: boolean;
}

interface MaterialCompileRequest {
  materialVersion: number;
  sceneRevision: number;
  variant: MaterialProgramVariant;
}

function materialSet(material: MeshMaterial): Set<THREE.Material> {
  return new Set(Array.isArray(material) ? material : [material]);
}

function isQualityTier(value: string): value is QualityTier {
  return value === 'auto' || Object.prototype.hasOwnProperty.call(PERFORMANCE_CONFIG.tiers, value);
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function idleTurn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: UI_CONFIG.idleWorkTimeoutMs });
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function normalizeError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallback, { cause: error });
}

function requireHtmlCanvas(renderer: THREE.WebGPURenderer): HTMLCanvasElement {
  const canvas = renderer.domElement;
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Procedural Texture Lab requires an HTML canvas renderer target.');
  }
  return canvas;
}

function materialProgramVariant(material: THREE.Material): MaterialProgramVariant {
  const physicalMaterial = material as THREE.MeshPhysicalMaterial;
  const sheen = physicalMaterial.sheen > 0;
  const transmission = physicalMaterial.transmission > 0;
  return {
    key: `${sheen ? 'sheen' : 'no-sheen'}:${transmission ? 'transmission' : 'opaque'}`,
    sheen,
    transmission
  };
}

export class LabRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(
    RENDERER_CONFIG.cameraFov,
    1,
    RENDERER_CONFIG.cameraNear,
    RENDERER_CONFIG.cameraFar
  );
  private readonly renderer: THREE.WebGPURenderer;
  private readonly bakeRenderer: WebGLRenderer;
  private readonly rendererReady: Promise<void>;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly compiler: MaterialCompiler;
  private readonly environments: EnvironmentLibrary;
  private readonly baker: TextureBaker;
  private readonly glbExporter: GlbExporter;
  private readonly profiler = new PerformanceProfiler(PERFORMANCE_CONFIG.sampleIntervalMs);
  private readonly hemisphere = new THREE.HemisphereLight('#edf4ff', '#231d1a', 1.2);
  private readonly key = new THREE.DirectionalLight('#fff3e4', 3.1);
  private readonly fill = new THREE.DirectionalLight('#b8d5ff', 1.15);
  private readonly rim = new THREE.DirectionalLight('#ffb18f', 1.35);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionBox = new THREE.Box3();
  private readonly selectionHelper = new THREE.Box3Helper(this.selectionBox, 0x8d9dff);
  private readonly interactionAbort = new AbortController();
  private readonly materialProgramKeepers = new Map<string, MaterialCompiler>();

  private currentRoot: THREE.Object3D | null = null;
  private readonly meshById = new Map<string, THREE.Mesh>();
  private readonly originalMeshStates = new Map<string, OriginalMeshState>();
  private selectedMeshId: string | null = null;
  private meshSelectionCallback: ((id: string | null) => void) | null = null;
  private performanceCallback: ((stats: PerformanceStats) => void) | null = null;
  private requestedQualityTier: QualityTier = PERFORMANCE_CONFIG.defaultTier;
  private activeQualityTier: FixedQualityTier = PERFORMANCE_CONFIG.autoDesktopTier;
  private presetThumbnailRenderer: PresetThumbnailRenderer | null = null;
  private currentEnvironment: EnvironmentPreset = DEFAULT_ENVIRONMENT;
  private currentEnvironmentName: string | null = null;
  private materialCompilePromise: Promise<void> | null = null;
  private materialCompileFailure: MaterialCompileFailure | null = null;
  private rendererInitializationError: Error | null = null;
  private materialCompileStage: MaterialCompileStage | null = null;
  private environmentWarmupFrame: number | null = null;
  private environmentWarmupActive = false;
  private compiledMaterialVersion = -1;
  private compiledSceneRevision = -1;
  private sceneRevision = 0;
  private animationFrame = 0;
  private disposed = false;

  public constructor(container: HTMLElement, compiler: MaterialCompiler) {
    this.container = container;
    this.compiler = compiler;
    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.bakeRenderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.canvas = requireHtmlCanvas(this.renderer);
    this.canvas.className = 'lab-canvas';
    container.append(this.canvas);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.bakeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.bakeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.bakeRenderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    this.scene.background = new THREE.Color(DEFAULT_BACKGROUND);

    this.environments = new EnvironmentLibrary(this.renderer);
    this.baker = new TextureBaker(this.bakeRenderer, this.compiler);
    this.glbExporter = new GlbExporter(this.baker, this.compiler);
    this.camera.position.fromArray(RENDERER_CONFIG.cameraPosition);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = true;
    this.controls.minDistance = RENDERER_CONFIG.minDistance;
    this.controls.maxDistance = RENDERER_CONFIG.maxDistance;

    this.addStudioLighting();
    this.setQualityTier(PERFORMANCE_CONFIG.defaultTier);
    this.setEnvironment(DEFAULT_ENVIRONMENT);
    this.selectionHelper.visible = false;
    this.scene.add(this.selectionHelper);
    this.bindMeshPicking();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rendererReady = this.initializeRenderer();
    this.scheduleEnvironmentWarmup();
  }

  public setMeshSelectionCallback(callback: (id: string | null) => void): void {
    this.meshSelectionCallback = callback;
  }

  public setPerformanceCallback(callback: (stats: PerformanceStats) => void): void {
    this.performanceCallback = callback;
  }

  public setQualityTier(tier: QualityTier): FixedQualityTier {
    if (!isQualityTier(tier)) throw new Error(`Unsupported quality tier: ${String(tier)}.`);
    this.requestedQualityTier = tier;
    const active = this.resolveQualityTier(tier);
    const settings = PERFORMANCE_CONFIG.tiers[active];
    this.activeQualityTier = active;

    if (
      this.key.shadow.mapSize.x !== settings.shadowMapSize ||
      this.key.shadow.mapSize.y !== settings.shadowMapSize
    ) {
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
      this.key.shadow.mapPass?.dispose();
      this.key.shadow.mapPass = null;
      this.key.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.key.shadow.needsUpdate = true;
    }

    this.resize();
    return active;
  }

  public getQualityTierSettings(): Readonly<QualityTierSettings> {
    return PERFORMANCE_CONFIG.tiers[this.activeQualityTier];
  }

  public setPrimitive(preset: ObjectPreset): void {
    const mesh = createProceduralMesh(preset, this.compiler.renderMaterial);
    this.applyProceduralMeshSettings(mesh);
    this.replaceRoot(mesh, new Map(), new Map());
  }

  public setImported(root: THREE.Object3D, assignments: Readonly<Record<string, boolean>> = {}): void {
    const originals = new Map<string, OriginalMeshState>();
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
      originals.set(id, {
        material: object.material,
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
        frustumCulled: object.frustumCulled,
        customDepthMaterial: object.customDepthMaterial,
        customDistanceMaterial: object.customDistanceMaterial
      });
      meshes.set(id, object);
    });

    this.replaceRoot(root, originals, meshes);
    this.setMeshAssignments(assignments);
  }

  public setMeshAssignments(assignments: Readonly<Record<string, boolean>>): void {
    let changed = false;
    for (const [id, mesh] of this.meshById) {
      const assigned = assignments[id] ?? true;
      if (assigned) {
        changed ||= mesh.material !== this.compiler.renderMaterial;
        mesh.material = this.compiler.renderMaterial;
        this.applyProceduralMeshSettings(mesh);
      } else {
        const original = this.originalMeshStates.get(id);
        if (original === undefined) continue;
        changed ||= mesh.material !== original.material;
        mesh.material = original.material;
        mesh.customDepthMaterial = original.customDepthMaterial;
        mesh.customDistanceMaterial = original.customDistanceMaterial;
        mesh.castShadow = original.castShadow;
        mesh.receiveShadow = original.receiveShadow;
        mesh.frustumCulled = original.frustumCulled;
      }
    }
    if (changed) this.invalidateScenePrograms();
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
    this.currentEnvironment = preset;
    this.currentEnvironmentName = customName;
    this.environments.cancelPending();
    const hadEnvironment = this.scene.environment !== null;
    const profile = this.environments.apply(this.scene, preset, customName);
    if (hadEnvironment !== (this.scene.environment !== null)) this.invalidateScenePrograms();
    this.applyLightProfile(profile);
  }

  public discardCustomEnvironment(name: string): void {
    if (!this.environments.clearCustomEnvironment(name)) return;
    if (this.currentEnvironment === 'custom' && this.currentEnvironmentName === name) {
      this.setEnvironment('custom', name);
    }
  }

  public async loadEnvironmentHdr(file: File): Promise<boolean> {
    const loaded = await this.environments.loadHdr(file);
    if (loaded) this.setEnvironment('custom', file.name);
    return loaded;
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

  public async capturePng(): Promise<string> {
    await this.ensureMaterialReady();
    if (this.disposed) throw new Error('Renderer is no longer available.');
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  public async bakeCurrentMaterial(settings: Readonly<PhysicalSettings>): Promise<BakedTextureSet> {
    const target = this.getBakeTarget();
    const resolution = this.effectiveTextureResolution(this.getQualityTierSettings().bakeResolution);
    return this.baker.bake(target, settings, resolution);
  }

  public async exportCurrentGlb(settings: Readonly<PhysicalSettings>): Promise<Blob> {
    if (this.currentRoot === null) throw new Error('There is no preview object to export.');
    const quality = this.getQualityTierSettings();
    const bakeResolution = this.effectiveTextureResolution(quality.bakeResolution);
    const maxTextureSize = this.effectiveTextureResolution(quality.maxExportTextureSize);
    return this.glbExporter.export(this.currentRoot, settings, bakeResolution, maxTextureSize);
  }

  public generatePresetThumbnails(presets: readonly MaterialPreset[]): ReadonlyMap<string, string> {
    const renderer = new PresetThumbnailRenderer(this.bakeRenderer, DEFAULT_PHYSICAL);
    const thumbnails = new Map<string, string>();
    try {
      for (const preset of presets) thumbnails.set(preset.id, renderer.render(preset));
      return thumbnails;
    } finally {
      renderer.dispose();
    }
  }

  public async generatePresetThumbnail(preset: MaterialPreset): Promise<string> {
    this.presetThumbnailRenderer ??= new PresetThumbnailRenderer(this.bakeRenderer, DEFAULT_PHYSICAL);
    return this.presetThumbnailRenderer.renderAsync(preset);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.environmentWarmupFrame !== null) {
      cancelAnimationFrame(this.environmentWarmupFrame);
      this.environmentWarmupFrame = null;
    }
    cancelAnimationFrame(this.animationFrame);
    this.interactionAbort.abort();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeCurrentRoot();
    this.scene.remove(this.selectionHelper);
    this.selectionHelper.dispose();
    this.environments.dispose();
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    this.key.shadow.mapPass?.dispose();
    this.key.shadow.mapPass = null;
    this.presetThumbnailRenderer?.dispose();
    this.presetThumbnailRenderer = null;
    this.clearMaterialProgramKeepers();
    this.compiler.dispose();
    this.renderer.dispose();
    this.bakeRenderer.dispose();
    this.materialCompileStage = null;
    this.container.classList.remove('is-loading');
    this.container.removeAttribute('data-loading-label');
    this.container.removeAttribute('aria-busy');
  }

  private getBakeTarget(): THREE.Mesh {
    if (this.selectedMeshId !== null) {
      const selected = this.meshById.get(this.selectedMeshId);
      if (selected !== undefined) {
        if (!this.compiler.isProceduralMaterial(selected.material)) {
          throw new Error('The selected mesh is using its original material. Apply the lab material before baking it.');
        }
        return selected;
      }
    }

    if (this.currentRoot instanceof THREE.Mesh && this.compiler.isProceduralMaterial(this.currentRoot.material)) {
      return this.currentRoot;
    }

    let firstAssigned: THREE.Mesh | null = null;
    this.currentRoot?.traverse((object) => {
      if (
        firstAssigned === null &&
        object instanceof THREE.Mesh &&
        this.compiler.isProceduralMaterial(object.material)
      ) {
        firstAssigned = object;
      }
    });
    if (firstAssigned === null) throw new Error('No mesh currently uses the lab material.');
    return firstAssigned;
  }

  private resolveQualityTier(tier: QualityTier): FixedQualityTier {
    if (tier !== 'auto') return tier;
    return window.matchMedia('(pointer: coarse)').matches
      ? PERFORMANCE_CONFIG.autoMobileTier
      : PERFORMANCE_CONFIG.autoDesktopTier;
  }

  private effectiveTextureResolution(requested: number): number {
    const maxTextureSize = Math.max(this.bakeRenderer.capabilities.maxTextureSize, 128);
    let resolution = Math.min(requested, maxTextureSize);
    resolution = 2 ** Math.floor(Math.log2(resolution));
    return Math.max(resolution, 128);
  }

  private applyProceduralMeshSettings(mesh: THREE.Mesh): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = undefined;
    mesh.customDistanceMaterial = undefined;
  }

  private addStudioLighting(): void {
    this.scene.add(this.hemisphere);
    this.key.position.set(-3.5, 4.2, 4.5);
    this.key.castShadow = true;
    this.key.shadow.camera.near = 0.1;
    this.key.shadow.camera.far = 15;
    this.key.shadow.bias = RENDERER_CONFIG.shadowBias;
    this.key.shadow.normalBias = RENDERER_CONFIG.shadowNormalBias;
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
    originals: Map<string, OriginalMeshState>,
    meshes: Map<string, THREE.Mesh>
  ): void {
    this.disposeCurrentRoot();
    this.currentRoot = root;
    this.originalMeshStates.clear();
    originals.forEach((state, id) => this.originalMeshStates.set(id, state));
    this.meshById.clear();
    meshes.forEach((mesh, id) => this.meshById.set(id, mesh));
    this.selectedMeshId = null;
    this.selectionHelper.visible = false;
    this.scene.add(root);
    this.invalidateScenePrograms();
    this.frameSelection();
  }

  private disposeCurrentRoot(): void {
    const root = this.currentRoot;
    if (root === null) return;

    const visibleMeshMaterials = collectMeshMaterials(root);
    const retainedNonMesh = collectNonMeshMaterials(root);
    const hiddenOriginals = new Set<THREE.Material>();
    for (const original of this.originalMeshStates.values()) {
      for (const item of materialSet(original.material)) {
        if (!visibleMeshMaterials.has(item)) hiddenOriginals.add(item);
      }
      if (original.customDepthMaterial !== undefined) hiddenOriginals.add(original.customDepthMaterial);
      if (original.customDistanceMaterial !== undefined) hiddenOriginals.add(original.customDistanceMaterial);
    }
    disposeMaterialResources(hiddenOriginals, new Set([...visibleMeshMaterials, ...retainedNonMesh]));

    this.scene.remove(root);
    disposeObjectResources(root, new Set([this.compiler.material, this.compiler.renderMaterial]));
    this.currentRoot = null;
    this.originalMeshStates.clear();
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

  private scheduleEnvironmentWarmup(): void {
    this.environmentWarmupFrame = requestAnimationFrame(() => {
      this.environmentWarmupFrame = null;
      void (async () => {
        await nextPaint();
        await idleTurn();
        await this.warmEnvironment();
      })();
    });
  }

  private async warmEnvironment(): Promise<void> {
    if (this.disposed || this.environments.studioReady) return;
    this.environmentWarmupActive = true;
    this.profiler.reset();
    this.updateBusyIndicator();
    try {
      await this.environments.prepareStudio();
      if (this.disposed) return;
      this.setEnvironment(this.currentEnvironment, this.currentEnvironmentName);
    } catch (error) {
      console.error('Studio environment warmup failed.', error);
    } finally {
      this.environmentWarmupActive = false;
      this.profiler.reset();
      this.updateBusyIndicator();
    }
  }

  private async initializeRenderer(): Promise<void> {
    try {
      await this.renderer.init();
      if (!this.disposed) this.start();
    } catch (error) {
      this.rendererInitializationError = normalizeError(error, 'WebGPU renderer initialization failed.');
      console.error('WebGPU renderer initialization failed.', this.rendererInitializationError);
      this.updateBusyIndicator();
    }
  }

  private invalidateScenePrograms(): void {
    this.sceneRevision += 1;
    this.clearMaterialProgramKeepers();
  }

  private clearMaterialProgramKeepers(): void {
    for (const keeper of this.materialProgramKeepers.values()) keeper.dispose();
    this.materialProgramKeepers.clear();
  }

  private materialNeedsCompilation(): boolean {
    const material = this.compiler.renderMaterial;
    return this.currentRoot !== null && (
      material.version !== this.compiledMaterialVersion ||
      this.sceneRevision !== this.compiledSceneRevision
    );
  }

  private currentMaterialCompileFailure(): MaterialCompileFailure | null {
    const failure = this.materialCompileFailure;
    if (
      failure === null ||
      failure.materialVersion !== this.compiler.renderMaterial.version ||
      failure.sceneRevision !== this.sceneRevision
    ) {
      return null;
    }
    return failure;
  }

  private isCompileRequestCurrent(request: Readonly<MaterialCompileRequest>): boolean {
    return request.materialVersion === this.compiler.renderMaterial.version &&
      request.sceneRevision === this.sceneRevision;
  }

  private startMaterialCompilation(): void {
    if (
      this.disposed ||
      this.rendererInitializationError !== null ||
      this.materialCompilePromise !== null ||
      !this.materialNeedsCompilation() ||
      this.currentMaterialCompileFailure() !== null
    ) return;

    const request: MaterialCompileRequest = {
      materialVersion: this.compiler.renderMaterial.version,
      sceneRevision: this.sceneRevision,
      variant: materialProgramVariant(this.compiler.renderMaterial)
    };
    this.profiler.reset();
    this.materialCompileStage = 'queued';

    let compilation: Promise<void>;
    compilation = this.compileMaterial(request)
      .catch((error: unknown) => {
        const compileError = normalizeError(error, 'Asynchronous material compilation failed.');
        this.materialCompileFailure = {
          materialVersion: request.materialVersion,
          sceneRevision: request.sceneRevision,
          error: compileError
        };
        console.error('Asynchronous material compilation failed.', compileError);
      })
      .finally(() => {
        if (this.materialCompilePromise === compilation) {
          this.materialCompilePromise = null;
          this.materialCompileStage = null;
        }
        this.profiler.reset();
        if (
          !this.disposed &&
          this.materialNeedsCompilation() &&
          this.currentMaterialCompileFailure() === null
        ) this.startMaterialCompilation();
        this.updateBusyIndicator();
      });
    this.materialCompilePromise = compilation;
    this.updateBusyIndicator();
  }

  private async compileMaterial(request: Readonly<MaterialCompileRequest>): Promise<void> {
    await nextPaint();
    await idleTurn();
    if (this.disposed || !this.isCompileRequestCurrent(request)) return;

    this.materialCompileStage = 'compiling';
    this.updateBusyIndicator();
    await nextPaint();
    if (this.disposed || !this.isCompileRequestCurrent(request)) return;

    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;

    this.compiledMaterialVersion = request.materialVersion;
    this.compiledSceneRevision = request.sceneRevision;
    this.materialCompileFailure = null;
    if (!this.isCompileRequestCurrent(request)) return;

    this.materialCompileStage = 'retaining';
    this.updateBusyIndicator();
    try {
      await this.retainMaterialProgram(request);
    } catch (error) {
      console.warn('Material shader cache retention failed.', error);
    }
  }

  private async retainMaterialProgram(request: Readonly<MaterialCompileRequest>): Promise<void> {
    if (
      this.disposed ||
      request.sceneRevision !== this.sceneRevision ||
      this.materialProgramKeepers.has(request.variant.key)
    ) return;

    const target = this.currentRoot instanceof THREE.Mesh && this.currentRoot.material === this.compiler.renderMaterial
      ? this.currentRoot
      : [...this.meshById.values()].find((mesh) => mesh.material === this.compiler.renderMaterial) ?? null;
    if (target === null) return;

    const keeper = new MaterialCompiler();
    const keeperMaterial = keeper.renderMaterial as THREE.MeshPhysicalMaterial;
    keeperMaterial.sheen = request.variant.sheen ? 1 : 0;
    keeperMaterial.transmission = request.variant.transmission ? 1 : 0;
    const originalMaterial = target.material;
    let retained = false;

    try {
      target.material = keeperMaterial;
      await this.renderer.compileAsync(this.scene, this.camera);
      if (
        this.disposed ||
        request.sceneRevision !== this.sceneRevision ||
        this.materialProgramKeepers.has(request.variant.key)
      ) return;
      this.materialProgramKeepers.set(request.variant.key, keeper);
      retained = true;
    } finally {
      target.material = originalMaterial;
      if (!retained) keeper.dispose();
    }
  }

  private async ensureMaterialReady(): Promise<void> {
    await this.rendererReady;
    if (this.rendererInitializationError !== null) {
      throw new Error('Renderer initialization failed.', { cause: this.rendererInitializationError });
    }
    while (!this.disposed && this.materialNeedsCompilation()) {
      const failure = this.currentMaterialCompileFailure();
      if (failure !== null) {
        throw new Error('Material shader compilation failed.', { cause: failure.error });
      }
      this.startMaterialCompilation();
      const pending = this.materialCompilePromise;
      if (pending === null) break;
      await pending;
    }
    if (this.disposed) throw new Error('Renderer is no longer available.');
    const failure = this.currentMaterialCompileFailure();
    if (failure !== null) throw new Error('Material shader compilation failed.', { cause: failure.error });
  }

  private updateBusyIndicator(): void {
    let label: string | null = null;
    if (this.rendererInitializationError !== null) {
      label = null;
    } else if (this.materialCompilePromise !== null) {
      if (this.materialCompileStage === 'queued') {
        label = 'Preparing material · waiting for browser…';
      } else if (this.materialCompileStage === 'retaining') {
        label = 'Preparing material · caching shader…';
      } else {
        label = 'Preparing material · compiling GPU shaders…';
      }
    } else if (this.environmentWarmupActive) {
      label = 'Preparing studio lighting…';
    }
    this.container.classList.toggle('is-loading', label !== null);
    if (label === null) {
      this.container.removeAttribute('data-loading-label');
      this.container.removeAttribute('aria-busy');
      return;
    }
    this.container.dataset.loadingLabel = label;
    this.container.setAttribute('aria-busy', 'true');
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (parent === null) return;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    const quality = PERFORMANCE_CONFIG.tiers[this.activeQualityTier];
    const pixelRatio = Math.min(
      window.devicePixelRatio,
      RENDERER_CONFIG.maxPixelRatio,
      quality.maxPixelRatio
    );
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private start(): void {
    const render = (): void => {
      if (this.disposed) return;
      this.animationFrame = requestAnimationFrame(render);
      this.controls.update();
      if (this.selectionHelper.visible && this.selectedMeshId !== null) {
        const mesh = this.meshById.get(this.selectedMeshId);
        if (mesh !== undefined) this.selectionBox.setFromObject(mesh);
      }

      this.startMaterialCompilation();
      if (this.materialCompilePromise !== null || this.currentMaterialCompileFailure() !== null) return;

      this.renderer.render(this.scene, this.camera);
      const stats = this.profiler.sample(
        this.renderer,
        this.requestedQualityTier,
        this.activeQualityTier
      );
      if (stats !== null) this.performanceCallback?.(stats);
    };
    render();
  }
}
