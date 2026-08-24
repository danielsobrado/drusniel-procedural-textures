import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGLRenderer } from 'three';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_ENVIRONMENT,
  PERFORMANCE_CONFIG,
  RENDERER_CONFIG
} from '../app/constants';
import type { GlbExporter } from '../export/GlbExporter';
import type { BakeProgressCallback, BakedTextureSet, TextureBaker } from '../export/TextureBaker';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type {
  EnvironmentPreset,
  ObjectPreset,
  PhysicalSettings
} from '../materials/types';
import { finishBoot, reportBootStage } from '../app/BootProgress';
import { canvasToPngDataUrl } from '../utils/canvas';
import { idleTurn, nextPaint } from '../utils/scheduling';
import { EnvironmentLibrary, type StudioLightProfile } from './EnvironmentLibrary';
import { createProceduralMesh } from './MeshFactory';
import {
  collectMeshMaterials,
  collectNonMeshMaterials,
  disposeMaterialResources,
  disposeObjectResources
} from './ObjectResources';
import { PerformanceProfiler } from './PerformanceProfiler';
import { SmoothOrbitZoom } from './SmoothOrbitZoom';
import {
  createOptionalWebGlRenderer,
  WEBGL2_UNAVAILABLE_MESSAGE
} from './WebGlRenderer';
import type {
  FixedQualityTier,
  PerformanceStats,
  QualityTier,
  QualityTierSettings
} from './Quality';

type MeshMaterial = THREE.Material | THREE.Material[];

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

function materialSet(material: MeshMaterial): Set<THREE.Material> {
  return new Set(Array.isArray(material) ? material : [material]);
}

function isQualityTier(value: string): value is QualityTier {
  return value === 'auto' || Object.prototype.hasOwnProperty.call(PERFORMANCE_CONFIG.tiers, value);
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
  private bakeRenderer: WebGLRenderer | null = null;
  private bakeRendererResolved = false;
  private readonly rendererReady: Promise<void>;
  private readonly controls: OrbitControls;
  private readonly smoothZoom: SmoothOrbitZoom;
  private readonly resizeObserver: ResizeObserver;
  private readonly compiler: MaterialCompiler;
  private readonly environments: EnvironmentLibrary;
  private baker: TextureBaker | null = null;
  private glbExporter: GlbExporter | null = null;
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

  private currentRoot: THREE.Object3D | null = null;
  private readonly meshById = new Map<string, THREE.Mesh>();
  private readonly originalMeshStates = new Map<string, OriginalMeshState>();
  private selectedMeshId: string | null = null;
  private meshSelectionCallback: ((id: string | null) => void) | null = null;
  private performanceCallback: ((stats: PerformanceStats) => void) | null = null;
  private requestedQualityTier: QualityTier = PERFORMANCE_CONFIG.defaultTier;
  private activeQualityTier: FixedQualityTier = PERFORMANCE_CONFIG.autoDesktopTier;
  private currentEnvironment: EnvironmentPreset = DEFAULT_ENVIRONMENT;
  private currentEnvironmentName: string | null = null;
  private materialCompilePromise: Promise<void> | null = null;
  private materialCompileFailure: MaterialCompileFailure | null = null;
  private rendererInitializationError: Error | null = null;
  private environmentWarmupFrame: number | null = null;
  private environmentWarmupActive = false;
  private compiledMaterialVersion = -1;
  private compiledSceneRevision = -1;
  private sceneRevision = 0;
  private animationFrame = 0;
  private needsRender = true;
  private disposed = false;

  public constructor(container: HTMLElement, compiler: MaterialCompiler) {
    this.container = container;
    this.compiler = compiler;
    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
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
    container.dataset.bakeBackend = 'deferred';
    this.scene.background = new THREE.Color(DEFAULT_BACKGROUND);

    this.environments = new EnvironmentLibrary(this.renderer);
    this.camera.position.fromArray(RENDERER_CONFIG.cameraPosition);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = true;
    this.controls.minDistance = RENDERER_CONFIG.minDistance;
    this.controls.maxDistance = RENDERER_CONFIG.maxDistance;
    this.smoothZoom = new SmoothOrbitZoom(this.camera, this.controls, this.canvas);

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

  /**
   * Marks the viewport as needing a redraw. The render loop is on-demand, so anything
   * that changes what the camera would see must call this. Over-calling costs one
   * frame; under-calling leaves a stale viewport, so prefer to call it.
   */
  public invalidate(): void {
    this.needsRender = true;
  }

  public getQualityTierSettings(): Readonly<QualityTierSettings> {
    return PERFORMANCE_CONFIG.tiers[this.activeQualityTier];
  }

  public supportsTextureBaking(): boolean {
    return this.ensureBakeRenderer() !== null;
  }

  public setPrimitive(preset: ObjectPreset): void {
    const canReuseCompiledMaterial = this.currentRoot instanceof THREE.Mesh &&
      this.currentRoot.userData.labProceduralPreview === true &&
      this.compiler.isProceduralMaterial(this.currentRoot.material);
    const mesh = createProceduralMesh(preset, this.compiler.renderMaterial);
    this.applyProceduralMeshSettings(mesh);
    this.replaceRoot(mesh, new Map(), new Map(), !canReuseCompiledMaterial);
  }

  public async waitForMaterialReady(): Promise<void> {
    await this.ensureMaterialReady();
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
    if (changed) this.sceneRevision += 1;
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
    if (hadEnvironment !== (this.scene.environment !== null)) this.sceneRevision += 1;
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

    this.smoothZoom.cancel();
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
    this.smoothZoom.cancel();
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
    return canvasToPngDataUrl(this.canvas);
  }

  public async bakeCurrentMaterial(
    settings: Readonly<PhysicalSettings>,
    onProgress?: BakeProgressCallback
  ): Promise<BakedTextureSet> {
    const baker = await this.requireBaker();
    const target = this.getBakeTarget();
    const resolution = this.effectiveTextureResolution(this.getQualityTierSettings().bakeResolution);
    return baker.bake(target, settings, resolution, onProgress);
  }

  public async exportCurrentGlb(settings: Readonly<PhysicalSettings>): Promise<Blob> {
    const glbExporter = await this.requireGlbExporter();
    if (this.currentRoot === null) throw new Error('There is no preview object to export.');
    const quality = this.getQualityTierSettings();
    const bakeResolution = this.effectiveTextureResolution(quality.bakeResolution);
    const maxTextureSize = this.effectiveTextureResolution(quality.maxExportTextureSize);
    return glbExporter.export(this.currentRoot, settings, bakeResolution, maxTextureSize);
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
    this.smoothZoom.dispose();
    this.controls.dispose();
    this.disposeCurrentRoot();
    this.scene.remove(this.selectionHelper);
    this.selectionHelper.dispose();
    this.environments.dispose();
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
    this.key.shadow.mapPass?.dispose();
    this.key.shadow.mapPass = null;
    this.compiler.dispose();
    this.renderer.dispose();
    this.bakeRenderer?.dispose();
    this.container.querySelector('[data-role="renderer-fallback"]')?.remove();
    delete this.container.dataset.rendererState;
    delete this.container.dataset.bakeBackend;
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

  /**
   * The bake/export path needs a second, WebGL2 context. Creating it during boot cost a
   * real GPU context on every load for a feature most sessions never touch, so it is
   * built on first use instead. The negative result is cached too - a browser without
   * WebGL2 should be asked exactly once.
   */
  private ensureBakeRenderer(): WebGLRenderer | null {
    if (this.bakeRendererResolved) return this.bakeRenderer;
    this.bakeRendererResolved = true;

    const renderer = createOptionalWebGlRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });

    if (renderer !== null) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    }

    this.bakeRenderer = renderer;
    if (!this.disposed) {
      this.container.dataset.bakeBackend = renderer === null ? 'unavailable' : 'webgl2';
    }
    return renderer;
  }

  private requireBakeRenderer(): WebGLRenderer {
    const renderer = this.ensureBakeRenderer();
    if (renderer === null) throw new Error(WEBGL2_UNAVAILABLE_MESSAGE);
    return renderer;
  }

  /**
   * The bake and GLB-export modules pull in GLTFExporter, SkeletonUtils and the
   * tessellation modifier - roughly a third of a megabyte of dependency that a session
   * which never exports should not download. Both entry points are already async.
   */
  private async requireBaker(): Promise<TextureBaker> {
    if (this.baker === null) {
      const renderer = this.requireBakeRenderer();
      const { TextureBaker: Baker } = await import('../export/TextureBaker');
      this.baker ??= new Baker(renderer, this.compiler);
    }
    return this.baker;
  }

  private async requireGlbExporter(): Promise<GlbExporter> {
    if (this.glbExporter === null) {
      const baker = await this.requireBaker();
      const { GlbExporter: Exporter } = await import('../export/GlbExporter');
      this.glbExporter ??= new Exporter(baker, this.compiler);
    }
    return this.glbExporter;
  }

  private resolveQualityTier(tier: QualityTier): FixedQualityTier {
    if (tier !== 'auto') return tier;
    return window.matchMedia('(pointer: coarse)').matches
      ? PERFORMANCE_CONFIG.autoMobileTier
      : PERFORMANCE_CONFIG.autoDesktopTier;
  }

  private effectiveTextureResolution(requested: number): number {
    const maxTextureSize = Math.max(this.requireBakeRenderer().capabilities.maxTextureSize, 128);
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
    meshes: Map<string, THREE.Mesh>,
    recompileMaterial = true
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
    if (recompileMaterial) this.sceneRevision += 1;
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
    if (this.disposed || this.rendererInitializationError !== null || this.environments.studioReady) return;
    this.environmentWarmupActive = true;
    reportBootStage('Preparing studio lighting');
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
      this.invalidate();
    }
  }

  private async initializeRenderer(): Promise<void> {
    try {
      await this.renderer.init();
      if (!this.disposed) {
        this.container.dataset.rendererState = 'ready';
        reportBootStage('Compiling material');
        this.start();
      }
    } catch (error) {
      this.rendererInitializationError = normalizeError(error, 'WebGPU renderer initialization failed.');
      console.warn('GPU renderer unavailable; continuing without the 3D preview.', this.rendererInitializationError);
      this.showRendererFallback();
      this.updateBusyIndicator();
      finishBoot();
    }
  }

  private showRendererFallback(): void {
    if (this.disposed) return;
    this.container.dataset.rendererState = 'unavailable';
    this.canvas.hidden = true;
    if (this.container.querySelector('[data-role="renderer-fallback"]') !== null) return;

    const fallback = document.createElement('div');
    fallback.className = 'renderer-fallback';
    fallback.dataset.role = 'renderer-fallback';
    fallback.setAttribute('role', 'status');

    const title = document.createElement('strong');
    title.textContent = '3D preview unavailable';
    const detail = document.createElement('span');
    detail.textContent = 'The editor remains available. Enable WebGPU or WebGL2 to restore the live preview.';
    fallback.append(title, detail);
    this.container.append(fallback);
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

  private startMaterialCompilation(): void {
    if (
      this.disposed ||
      this.rendererInitializationError !== null ||
      this.materialCompilePromise !== null ||
      !this.materialNeedsCompilation() ||
      this.currentMaterialCompileFailure() !== null
    ) return;

    const materialVersion = this.compiler.renderMaterial.version;
    const sceneRevision = this.sceneRevision;
    this.profiler.reset();
    let compilation: Promise<void>;
    compilation = this.renderer.compileAsync(this.scene, this.camera)
      .then(() => {
        this.compiledMaterialVersion = materialVersion;
        this.compiledSceneRevision = sceneRevision;
        this.materialCompileFailure = null;
      })
      .catch((error: unknown) => {
        const compileError = normalizeError(error, 'Asynchronous material compilation failed.');
        this.materialCompileFailure = { materialVersion, sceneRevision, error: compileError };
        console.error('Asynchronous material compilation failed.', compileError);
      })
      .finally(() => {
        if (this.materialCompilePromise === compilation) this.materialCompilePromise = null;
        this.profiler.reset();
        this.invalidate();
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
    const label = this.rendererInitializationError !== null
      ? null
      : this.materialCompilePromise !== null
        ? 'Preparing material…'
        : this.environmentWarmupActive
          ? 'Preparing studio lighting…'
          : null;
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
    this.invalidate();
  }

  private start(): void {
    let previousFrameTime = performance.now();
    const render = (frameTime: number): void => {
      if (this.disposed) return;
      this.animationFrame = requestAnimationFrame(render);

      const deltaSeconds = Math.min(Math.max((frameTime - previousFrameTime) / 1000, 0), 0.05);
      previousFrameTime = frameTime;
      const zoomMoved = this.smoothZoom.update(deltaSeconds);
      // OrbitControls reports whether damping is still settling; while it is, every
      // frame is genuinely different and must be drawn.
      const cameraMoved = this.controls.update() || zoomMoved;

      this.startMaterialCompilation();
      if (this.materialCompilePromise !== null) return;
      if (this.currentMaterialCompileFailure() !== null) {
        // A failed compile never produces a frame, so the splash would otherwise
        // outlive boot. The failure itself is surfaced by the busy indicator.
        finishBoot();
        return;
      }

      // No material in this app is time-driven, so an unchanged scene re-rendered at
      // 60 Hz was pure waste - it saturated the GPU and made every backdrop-filtered
      // panel re-blur on each frame.
      if (!this.needsRender && cameraMoved !== true) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      this.needsRender = false;

      this.renderer.render(this.scene, this.camera);
      // The splash is dismissed by the first frame the user could actually see,
      // not by the renderer merely reporting itself ready.
      finishBoot();
      const stats = this.profiler.sample(
        this.renderer,
        this.requestedQualityTier,
        this.activeQualityTier
      );
      if (stats !== null) this.performanceCallback?.(stats);
    };
    render(previousFrameTime);
  }
}
