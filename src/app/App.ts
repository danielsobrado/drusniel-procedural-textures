import {
  AUTOSAVE_DELAY_MS,
  EXPORT_CONFIG,
  HISTORY_LIMIT,
  LEGACY_STORAGE_KEYS,
  MAX_MODEL_FILE_BYTES,
  MAX_PROJECT_FILE_BYTES,
  OBJECT_PRESETS,
  PERFORMANCE_CONFIG,
  STORAGE_KEY,
  UI_CONFIG
} from './constants';
import { AppState, createDefaultProject, type StateChangeReason } from './AppState';
import { reportBootStage } from './BootProgress';
import { ImportedFileCache } from './ImportedFileCache';
import {
  MAX_IMPORTED_MESHES,
  normalizeImportedAssetName,
  normalizeProject
} from './ProjectFile';
import { LabRenderer } from '../engine/LabRenderer';
import { describeImportedMeshes, ModelLoader } from '../engine/ModelLoader';
import { disposeObjectResources } from '../engine/ObjectResources';
import type { QualityTier } from '../engine/Quality';
import { TILE_CONFIG } from '../config/tileConfig';
import { makeTextureSetSeamless } from '../export/SeamlessTexture';
import { TileMaterialBaker } from '../export/TileMaterialBaker';
import type { BakeChannel, BakedTextureSet } from '../export/TextureBaker';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { EnvironmentPreset, LayerKind, ProjectState } from '../materials/types';
import { serializeMaterialRecipe } from '../runtime/MaterialRecipe';
import { Inspector } from '../ui/Inspector';
import { LayerStrip } from '../ui/LayerStrip';
import { LibraryPanel } from '../ui/LibraryPanel';
import { ProgressOverlay } from '../ui/ProgressOverlay';
import { RadialMenu, type RadialCommand } from '../ui/RadialMenu';
import { Shell } from '../ui/Shell';
import { TilePreviewPanel } from '../ui/TilePreviewPanel';
import { TileWorkspace } from '../ui/TileWorkspace';
import { downloadBlob, downloadDataUrl, downloadText } from '../utils/download';
import { idleTurn, nextPaint } from '../utils/scheduling';

const BYTES_PER_MIB = 1024 * 1024;

const BAKE_CHANNEL_LABELS: Readonly<Record<BakeChannel, string>> = {
  albedo: 'albedo',
  roughness: 'roughness',
  normal: 'normal',
  height: 'height',
  clearcoat: 'clearcoat',
  'clearcoat-roughness': 'clearcoat roughness',
  metallic: 'metallic',
  ao: 'ambient occlusion',
  emissive: 'emissive'
};
const IMPORT_CACHE_ENTRY_LIMIT = HISTORY_LIMIT + 1;
const MODEL_EXTENSIONS = new Set(['glb', 'gltf']);

type ProductionOperation = 'bake' | 'export' | 'tile';

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('button, a[href], summary, [role="button"], [role="menuitem"]') !== null;
}

function fileExtension(name: string): string {
  return name.toLowerCase().split('.').at(-1) ?? '';
}

function primaryModelFile(files: readonly File[]): File {
  const candidates = files.filter((file) => MODEL_EXTENSIONS.has(fileExtension(file.name)));
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new Error('Select exactly one GLB or GLTF primary file with its optional resource files.');
  }
  return candidates[0];
}

async function readUtf8File(file: File, label: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8.`, { cause: error });
  }
}

function loadInitialProject(): ProjectState {
  const storageKeys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const storageKey of storageKeys) {
    try {
      const serialized = localStorage.getItem(storageKey);
      if (serialized === null) continue;
      const project = normalizeProject(JSON.parse(serialized));
      if (storageKey !== STORAGE_KEY) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        } catch (error) {
          console.warn('Could not persist migrated autosave.', error);
        }
      }
      return project;
    } catch (error) {
      console.warn(`Ignoring invalid autosaved project from ${storageKey}.`, error);
    }
  }
  return createDefaultProject();
}

export class App {
  private readonly shell: Shell;
  private readonly state: AppState;
  private readonly compiler = new MaterialCompiler();
  private readonly renderer: LabRenderer;
  private readonly tileBaker: TileMaterialBaker;
  private readonly tileWorkspace: TileWorkspace;
  private readonly modelLoader = new ModelLoader();
  private readonly library: LibraryPanel;
  private readonly inspector: Inspector;
  private readonly layers: LayerStrip;
  private readonly radial: RadialMenu;
  private readonly tilePreview: TilePreviewPanel;
  private readonly importedFiles = new ImportedFileCache(IMPORT_CACHE_ENTRY_LIMIT, MAX_MODEL_FILE_BYTES);
  private autosaveTimer: number | null = null;
  private readonly progress: ProgressOverlay;
  private panelRenderFrame = 0;
  private pendingPanelState: Readonly<ProjectState> | null = null;
  private pendingLayersRender = false;
  private pendingInspectorRender = false;
  private pendingLibraryRender = false;
  private pendingAutosaveState: Readonly<ProjectState> | null = null;
  private autosaveFailureShown = false;
  private activeImportedName: string | null = null;
  private suppressImportedRestore = false;
  private projectImportSequence = 0;
  private environmentLoadSequence = 0;
  private productionOperation: ProductionOperation | null = null;
  private tilePreviewMaps: BakedTextureSet | null = null;
  private tilePreviewStale = true;
  private tilePreviewRevision = 0;

  public constructor(root: HTMLElement) {
    this.shell = new Shell(root);
    this.progress = new ProgressOverlay(root);
    this.tileWorkspace = new TileWorkspace(root);
    this.state = new AppState(loadInitialProject());
    reportBootStage('Starting renderer');
    this.renderer = new LabRenderer(this.shell.elements.viewport, this.compiler);
    this.tileBaker = new TileMaterialBaker(this.compiler);
    this.renderer.setMeshSelectionCallback((id) => this.state.selectMesh(id));
    this.renderer.setPerformanceCallback((stats) => this.shell.setPerformanceStats(stats));

    this.library = new LibraryPanel(this.shell.elements.library, {
      onObject: (preset) => this.runSafely(() => this.state.setObjectPreset(preset)),
      onPreset: (preset) => this.runSafely(() => this.state.applyPreset(preset)),
      onImport: () => this.shell.elements.modelInput.click(),
      getProjectState: () => this.state.snapshot
    });

    this.inspector = new Inspector(this.shell.elements.inspector, {
      onLayerPatch: (id, patch) => this.runSafely(() => this.state.updateLayer(id, patch)),
      onDuplicate: (id) => this.runSafely(() => this.state.duplicateLayer(id)),
      onRemove: (id) => this.runSafely(() => this.state.removeLayer(id)),
      onGroupAdd: (layerId) => this.runSafely(() => this.state.addGroup(layerId)),
      onGroupPatch: (id, patch) => this.runSafely(() => this.state.updateGroup(id, patch)),
      onGroupRemove: (id) => this.runSafely(() => this.state.removeGroup(id)),
      onBackground: (color) => this.runSafely(() => this.state.setBackground(color)),
      onWireframe: (enabled) => this.runSafely(() => this.state.setWireframe(enabled)),
      onPhysical: (patch) => this.runSafely(() => this.state.setPhysical(patch)),
      onSynthesis: (patch) => this.runSafely(() => this.state.setSynthesis(patch)),
      onGenomeLock: (key, enabled) => this.runSafely(() => this.state.setGenomeLock(key, enabled)),
      onMutate: (variant) => this.runSafely(() => this.state.mutateMaterialVariant(variant)),
      onGraphMode: (enabled) => this.state.setGraphMode(enabled),
      onGraphParameter: (id, value) => this.runSafely(() => this.state.setSurfaceGraphParameter(id, value)),
      onEnvironment: (environment) => this.selectEnvironment(environment),
      onEnvironmentImport: () => this.shell.elements.environmentInput.click(),
      onMeshSelect: (id) => this.state.selectMesh(id),
      onMeshAssigned: (id, assigned) => this.runSafely(() => this.state.setMeshAssignment(id, assigned))
    });

    this.layers = new LayerStrip(this.shell.elements.layers, {
      onAdd: (kind) => this.runSafely(() => this.state.addLayer(kind)),
      onSelect: (id) => this.state.selectLayer(id),
      onToggle: (id, enabled) => this.runSafely(() => this.state.updateLayer(id, { enabled })),
      onRemove: (id) => this.runSafely(() => this.state.removeLayer(id)),
      onDuplicate: (id) => this.runSafely(() => this.state.duplicateLayer(id)),
      onReorder: (id, targetIndex) => this.runSafely(() => this.state.reorderLayer(id, targetIndex))
    });

    this.tilePreview = new TilePreviewPanel(this.tileWorkspace.host, {
      onClose: () => this.tileWorkspace.setActive(false),
      onRefresh: () => { void this.refreshTilePreview(); },
      onSave: () => { void this.saveSeamlessTextures(); },
      onTextureRequested: () => { void this.ensureTileTexturePreview(); }
    });
    this.radial = new RadialMenu(this.shell.elements.radial, (command) => this.handleRadialCommand(command));
    this.state.subscribe((state, reason) => this.handleStateChange(state, reason));
    this.bindCommands();
    this.bindFiles();
    this.bindViewportGestures();
    this.bindKeyboard();
    this.syncAll(this.state.snapshot);
    void this.scheduleComputeStatusProbe();
  }

  private handleStateChange(state: Readonly<ProjectState>, reason: StateChangeReason): void {
    if (reason === 'project' || reason === 'environment') {
      this.environmentLoadSequence += 1;
    }

    if (reason === 'layers' || reason === 'groups' || reason === 'synthesis' || reason === 'project') {
      this.syncMaterial(state);
    } else if (reason === 'wireframe') {
      this.compiler.sync(state.layers, state.groups, state.wireframe, state.synthesis);
    } else if (reason === 'physical') {
      this.compiler.applyPhysical(state.physical);
    }

    if (
      reason === 'layers' || reason === 'groups' || reason === 'selection' ||
      reason === 'mesh' || reason === 'environment' || reason === 'synthesis' || reason === 'project'
    ) {
      this.schedulePanelRender(state, { layers: true, inspector: true });
    } else if (reason === 'background' || reason === 'wireframe' || reason === 'physical' || reason === 'object') {
      this.schedulePanelRender(state, { inspector: true });
    }

    if (reason === 'object' || reason === 'project') {
      this.syncObject(state);
      this.schedulePanelRender(state, { library: true });
    } else if (reason === 'mesh') {
      this.renderer.setMeshAssignments(state.meshAssignments);
      this.renderer.setSelectedMesh(state.selectedMeshId);
    }

    if (reason === 'background' || reason === 'project') this.renderer.setBackground(state.background);
    if (reason === 'environment' || reason === 'project') {
      this.renderer.setEnvironment(state.environment, state.environmentAssetName);
    }
    if (reason === 'layers' || reason === 'groups' || reason === 'physical' || reason === 'synthesis' || reason === 'project') {
      this.tilePreviewRevision += 1;
      this.tilePreviewStale = true;
      this.tilePreview.markStale();
    }

    this.renderer.invalidate();
    this.shell.setStatus(this.projectStatus(state));
    this.scheduleAutosave(state);
  }

  /**
   * Panel re-renders are coalesced to one frame. A slider drag emits a state change per
   * pointermove, and each one used to run the inspector and layer-strip renders
   * synchronously - together roughly a hundred DOM queries per event.
   */
  private schedulePanelRender(
    state: Readonly<ProjectState>,
    panels: { layers?: boolean; inspector?: boolean; library?: boolean }
  ): void {
    this.pendingPanelState = state;
    this.pendingLayersRender ||= panels.layers === true;
    this.pendingInspectorRender ||= panels.inspector === true;
    this.pendingLibraryRender ||= panels.library === true;
    if (this.panelRenderFrame !== 0) return;
    this.panelRenderFrame = window.requestAnimationFrame(() => {
      this.panelRenderFrame = 0;
      this.flushPanelRender();
    });
  }

  private flushPanelRender(): void {
    const state = this.pendingPanelState;
    const layers = this.pendingLayersRender;
    const inspector = this.pendingInspectorRender;
    const library = this.pendingLibraryRender;
    this.pendingPanelState = null;
    this.pendingLayersRender = false;
    this.pendingInspectorRender = false;
    this.pendingLibraryRender = false;
    if (state === null) return;
    this.runSafely(() => {
      if (layers) this.layers.render(state);
      if (inspector) this.inspector.render(state);
      if (library) this.library.render(state);
    });
  }

  private syncAll(state: Readonly<ProjectState>): void {
    this.syncMaterial(state);
    this.renderer.setBackground(state.background);
    this.renderer.setEnvironment(state.environment, state.environmentAssetName);
    this.syncObject(state);
    this.renderer.setMeshAssignments(state.meshAssignments);
    this.renderer.setSelectedMesh(state.selectedMeshId);
    this.library.render(state);
    this.inspector.render(state);
    this.layers.render(state);
    this.shell.setQualityTier(PERFORMANCE_CONFIG.defaultTier);
    this.shell.setStatus(this.projectStatus(state));
  }

  private syncMaterial(state: Readonly<ProjectState>): void {
    this.compiler.sync(state.layers, state.groups, state.wireframe, state.synthesis);
    this.compiler.applyPhysical(state.physical);
  }

  private syncObject(state: Readonly<ProjectState>): void {
    if (!this.suppressImportedRestore) {
      this.projectImportSequence += 1;
      this.modelLoader.cancelPending();
    }

    if (state.importedAssetName !== null && this.activeImportedName === state.importedAssetName) {
      this.shell.setObjectLabel(state.importedAssetName);
      this.renderer.setMeshAssignments(state.meshAssignments);
      this.renderer.setSelectedMesh(state.selectedMeshId);
      return;
    }

    this.activeImportedName = null;
    this.renderer.setPrimitive(state.selectedObject);
    const preset = OBJECT_PRESETS.find((item) => item.id === state.selectedObject);
    this.shell.setObjectLabel(preset?.label ?? state.selectedObject);

    if (state.importedAssetName === null || this.suppressImportedRestore) return;
    const cached = this.importedFiles.lookup(state.importedAssetName);
    if (cached.status === 'found') {
      void this.restoreImportedModel(cached.files, state.importedAssetName);
      return;
    }
    this.shell.toast('Imported mesh bytes are not embedded in project JSON. Re-import the model bundle to restore it.');
  }

  private bindCommands(): void {
    this.shell.onCommand('undo', () => { if (!this.state.undo()) this.shell.toast('Nothing to undo.'); });
    this.shell.onCommand('redo', () => { if (!this.state.redo()) this.shell.toast('Nothing to redo.'); });
    this.shell.onCommand('import-model', () => this.shell.elements.modelInput.click());
    this.shell.onCommand('open-project', () => this.shell.elements.projectInput.click());
    this.shell.onCommand('save-project', () => this.runSafely(() => this.exportProject()));
    this.shell.onCommand('export-material', () => this.runSafely(() => this.exportMaterialRecipe()));
    this.shell.onCommand('tile-preview', () => { void this.openTilePreview(); });
    this.shell.onCommand('bake-textures', () => { void this.bakeTextures(); });
    this.shell.onCommand('export-glb', () => { void this.exportGlb(); });
    this.shell.onCommand('frame', () => this.renderer.frameSelection());
    this.shell.onCommand('wireframe', () => this.state.toggleWireframe());
    this.shell.onCommand('snapshot', () => { void this.saveSnapshot(); });
    this.shell.onQualityChange((tier) => this.setQualityTier(tier));
  }

  private bindFiles(): void {
    this.shell.elements.modelInput.addEventListener('change', () => {
      const files = Array.from(this.shell.elements.modelInput.files ?? []);
      if (files.length > 0) void this.importModel(files);
      this.shell.elements.modelInput.value = '';
    });
    this.shell.elements.projectInput.addEventListener('change', () => {
      const file = this.shell.elements.projectInput.files?.[0];
      if (file !== undefined) void this.importProject(file);
      this.shell.elements.projectInput.value = '';
    });
    this.shell.elements.environmentInput.addEventListener('change', () => {
      const file = this.shell.elements.environmentInput.files?.[0];
      if (file !== undefined) void this.importEnvironment(file);
      this.shell.elements.environmentInput.value = '';
    });
  }

  private bindViewportGestures(): void {
    const viewport = this.shell.elements.viewport;
    let rightPress: { pointerId: number; startX: number; startY: number } | null = null;

    viewport.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (event.button !== 2) this.radial.open(event.clientX, event.clientY);
    });
    viewport.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button === 2) {
        rightPress = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
      }
    });
    viewport.addEventListener('pointermove', (event) => {
      if (rightPress === null || event.pointerId !== rightPress.pointerId) return;
      if (Math.hypot(event.clientX - rightPress.startX, event.clientY - rightPress.startY) > UI_CONFIG.radialClickMoveTolerancePx) {
        rightPress = null;
      }
    });
    viewport.addEventListener('pointerup', (event) => {
      if (rightPress !== null && event.pointerId === rightPress.pointerId && event.button === 2) {
        this.radial.open(event.clientX, event.clientY);
      }
      rightPress = null;
    });
    viewport.addEventListener('pointercancel', () => { rightPress = null; });
    viewport.addEventListener('dragenter', (event) => {
      event.preventDefault();
      this.shell.setDragging(true);
    });
    viewport.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    });
    viewport.addEventListener('dragleave', (event) => {
      if (event.relatedTarget instanceof Node && viewport.contains(event.relatedTarget)) return;
      this.shell.setDragging(false);
    });
    viewport.addEventListener('drop', (event) => {
      event.preventDefault();
      this.shell.setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) void this.importModel(files);
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (isTextEditingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') {
        event.preventDefault();
        event.shiftKey ? this.state.redo() : this.state.undo();
        return;
      }
      if (modifier && key === 'y' && !event.shiftKey) {
        event.preventDefault();
        this.state.redo();
        return;
      }
      if (isInteractiveTarget(event.target) || modifier || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        const bounds = this.shell.elements.viewport.getBoundingClientRect();
        this.radial.open(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, true);
      } else if (key === 'f') {
        this.renderer.frameSelection();
      } else if (key === 'w') {
        this.state.toggleWireframe();
      }
    });
  }

  private handleRadialCommand(command: RadialCommand): void {
    const layerCommand: Partial<Record<RadialCommand, LayerKind>> = {
      'add-noise': 'fbm',
      'add-cells': 'cellular',
      'add-veins': 'vessels',
      'add-wet': 'wet-film',
      'add-sss': 'sss'
    };
    const layerKind = layerCommand[command];
    if (layerKind !== undefined) {
      this.runSafely(() => this.state.addLayer(layerKind));
      return;
    }
    if (command === 'sphere') this.state.setObjectPreset('sphere');
    else if (command === 'torus') this.state.setObjectPreset('torus');
    else if (command === 'import') this.shell.elements.modelInput.click();
    else if (command === 'open-project') this.shell.elements.projectInput.click();
    else if (command === 'save-project') this.runSafely(() => this.exportProject());
    else if (command === 'bake-textures') void this.bakeTextures();
    else if (command === 'export-glb') void this.exportGlb();
    else if (command === 'frame') this.renderer.frameSelection();
    else if (command === 'wireframe') this.state.toggleWireframe();
  }

  private async importModel(files: readonly File[]): Promise<void> {
    this.projectImportSequence += 1;
    try {
      const primary = primaryModelFile(files);
      const assetName = normalizeImportedAssetName(primary.name);
      this.shell.setStatus(`Loading ${assetName}…`);
      const model = await this.modelLoader.load(files);
      if (model === null) return;

      const meshes = describeImportedMeshes(model);
      if (meshes.length > MAX_IMPORTED_MESHES) {
        disposeObjectResources(model);
        throw new Error(`Imported model exceeds the ${MAX_IMPORTED_MESHES} mesh target limit.`);
      }

      try {
        this.importedFiles.remember(assetName, files);
      } catch (error) {
        disposeObjectResources(model);
        throw error;
      }

      const assignments = Object.fromEntries(meshes.map((mesh) => [mesh.id, true]));
      this.renderer.setImported(model, assignments);
      this.activeImportedName = assetName;
      this.state.setImportedAsset(assetName, meshes);
      this.shell.setObjectLabel(assetName);
      this.shell.toast(`Imported ${assetName} · ${meshes.length} mesh${meshes.length === 1 ? '' : 'es'}`);
    } catch (error) {
      console.error('Model import failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.shell.setStatus('Import failed');
    }
  }

  private async restoreImportedModel(files: readonly File[], expectedName: string): Promise<void> {
    try {
      this.shell.setStatus(`Restoring ${expectedName}…`);
      const model = await this.modelLoader.load(files);
      if (model === null) return;
      if (this.state.snapshot.importedAssetName !== expectedName) {
        disposeObjectResources(model);
        return;
      }
      this.renderer.setImported(model, this.state.snapshot.meshAssignments);
      this.renderer.setSelectedMesh(this.state.snapshot.selectedMeshId);
      this.activeImportedName = expectedName;
      this.shell.setObjectLabel(expectedName);
      this.shell.setStatus(this.projectStatus(this.state.snapshot));
    } catch (error) {
      console.error('Model restore failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.shell.setStatus('Restore failed');
    }
  }

  private async importEnvironment(file: File): Promise<void> {
    const sequence = ++this.environmentLoadSequence;
    try {
      const assetName = normalizeImportedAssetName(file.name);
      this.shell.setStatus(`Loading ${assetName}…`);
      const loaded = await this.renderer.loadEnvironmentHdr(file);
      if (!loaded || sequence !== this.environmentLoadSequence) return;
      this.state.setEnvironment('custom', assetName);
      this.shell.toast(`Loaded HDR environment ${assetName}`);
    } catch (error) {
      if (sequence !== this.environmentLoadSequence) return;
      console.error('HDR environment import failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.renderer.setEnvironment(
        this.state.snapshot.environment,
        this.state.snapshot.environmentAssetName
      );
    }
  }

  private selectEnvironment(environment: EnvironmentPreset): void {
    this.environmentLoadSequence += 1;
    if (environment === 'custom' && this.state.snapshot.environmentAssetName === null) {
      this.shell.elements.environmentInput.click();
      return;
    }
    this.runSafely(() => this.state.setEnvironment(
      environment,
      environment === 'custom' ? this.state.snapshot.environmentAssetName : null
    ));
  }

  private async importProject(file: File): Promise<void> {
    const sequence = ++this.projectImportSequence;
    this.environmentLoadSequence += 1;
    this.modelLoader.cancelPending();
    try {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        const limitMiB = MAX_PROJECT_FILE_BYTES / BYTES_PER_MIB;
        throw new Error(`Project file exceeds the configured ${limitMiB.toFixed(1)} MiB limit.`);
      }
      const text = await readUtf8File(file, 'Project file');
      if (sequence !== this.projectImportSequence) return;
      const normalizedProject = normalizeProject(JSON.parse(text) as unknown);
      if (normalizedProject.environment === 'custom' && normalizedProject.environmentAssetName !== null) {
        this.renderer.discardCustomEnvironment(normalizedProject.environmentAssetName);
      }
      if (normalizedProject.importedAssetName !== null) {
        this.importedFiles.forget(normalizedProject.importedAssetName);
      }
      this.activeImportedName = null;
      this.suppressImportedRestore = true;
      try {
        this.state.replaceProject(normalizedProject);
      } finally {
        this.suppressImportedRestore = false;
      }
      if (sequence !== this.projectImportSequence) return;

      if (normalizedProject.importedAssetName !== null) this.syncObject(this.state.snapshot);
      if (normalizedProject.environment === 'custom' && normalizedProject.environmentAssetName !== null) {
        this.shell.toast(`Opened ${file.name}. Re-load ${normalizedProject.environmentAssetName} to restore the custom HDR.`);
      } else if (normalizedProject.importedAssetName === null) {
        this.shell.toast(`Opened ${file.name}`);
      } else {
        this.shell.toast(`Opened ${file.name}. Re-import ${normalizedProject.importedAssetName} to restore the model.`);
      }
    } catch (error) {
      if (sequence !== this.projectImportSequence) return;
      console.error('Project import failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    }
  }

  private exportProject(): void {
    downloadText('procedural-texture-lab.json', JSON.stringify(this.state.snapshot, null, 2));
    this.shell.toast('Project JSON saved.');
  }

  /**
   * Acquiring the compute device costs a full `requestAdapter`/`requestDevice` pair
   * plus a WGSL pipeline compile, and the default project has no simulation layer, so
   * none of it belongs on the boot path. Simulation correctness does not depend on this
   * running: `MaterialCompiler.prepareSimulation` awaits `compute.initialize()` itself.
   * This only keeps the status badge populated for a browser that never simulates.
   */
  private async scheduleComputeStatusProbe(): Promise<void> {
    await nextPaint();
    await idleTurn();
    await this.initializeCompute();
  }

  private async initializeCompute(): Promise<void> {
    const status = await this.compiler.initializeCompute();
    this.shell.elements.viewport.dataset.computeBackend = status.backend;
    this.shell.setStatus(this.projectStatus(this.state.snapshot));
  }

  private exportMaterialRecipe(): void {
    downloadText(
      'procedural-material.ptl.json',
      serializeMaterialRecipe(this.state.snapshot)
    );
    this.shell.toast('Portable PTL material recipe exported.');
  }

  private async saveSnapshot(): Promise<void> {
    try {
      const dataUrl = await this.renderer.capturePng();
      downloadDataUrl('procedural-texture-preview.png', dataUrl);
      this.shell.toast('Preview PNG saved.');
    } catch (error) {
      console.error('Preview capture failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    }
  }

  private async openTilePreview(): Promise<void> {
    this.tileWorkspace.setActive(true);
    if (this.tilePreview.textureModeActive) await this.ensureTileTexturePreview();
  }

  private async ensureTileTexturePreview(): Promise<void> {
    if (this.tilePreviewMaps !== null && !this.tilePreviewStale) {
      this.tilePreview.setMaps(this.tilePreviewMaps);
      return;
    }
    await this.refreshTilePreview();
  }

  private async refreshTilePreview(): Promise<void> {
    if (!this.beginProductionOperation('tile')) return;
    const revision = this.tilePreviewRevision;
    try {
      const requested = TILE_CONFIG.previewResolution;
      this.tilePreview.setLoading(`Baking seamless preview · ${requested}²…`);
      this.shell.setStatus(`Baking seamless tile preview · ${requested}²…`);
      this.progress.begin(`Baking seamless preview · ${requested}²`);
      this.progress.report('Generating seamless tile…', null);
      const maps = await this.buildSeamlessTileSet(requested);
      const isCurrent = revision === this.tilePreviewRevision;
      this.tilePreviewMaps = maps;
      this.tilePreviewStale = !isCurrent;
      this.tilePreview.setMaps(maps);
      if (!isCurrent) this.tilePreview.markStale();
    } catch (error) {
      console.error('Tile preview failed.', error);
      const message = this.errorMessage(error);
      this.tilePreview.setError(message);
      this.shell.toast(message, 'error');
    } finally {
      this.progress.finish();
      this.productionOperation = null;
      this.shell.setStatus(this.projectStatus(this.state.snapshot));
    }
  }

  private async saveSeamlessTextures(): Promise<void> {
    if (!this.beginProductionOperation('tile')) return;
    try {
      const quality = this.renderer.getQualityTierSettings();
      this.shell.setStatus(`Baking seamless PBR maps · ${quality.bakeResolution}²…`);
      this.progress.begin(`Baking seamless PBR maps · ${quality.bakeResolution}²`);
      this.progress.report('Generating seamless tile…', null);
      const maps = await this.buildSeamlessTileSet(quality.bakeResolution);
      const stem = `${EXPORT_CONFIG.textureFileStem}-${TILE_CONFIG.fileSuffix}`;
      this.downloadTextureSet(maps, stem);
      this.shell.toast(`Saved 9 seamless maps at ${maps.resolution}×${maps.resolution}.`);
    } catch (error) {
      console.error('Seamless texture export failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    } finally {
      this.progress.finish();
      this.productionOperation = null;
      this.shell.setStatus(this.projectStatus(this.state.snapshot));
    }
  }

  private async buildSeamlessTileSet(requestedResolution: number): Promise<BakedTextureSet> {
    const tile = TILE_CONFIG;
    const physical = structuredClone(this.state.snapshot.physical);
    const displacementExtent = this.compiler.displacementExtent;
    const maps = await this.tileBaker.bake(
      physical,
      requestedResolution,
      tile.worldSize
    );
    return makeTextureSetSeamless(maps, {
      blendFraction: tile.blendFraction,
      worldSize: tile.worldSize,
      displacementExtent
    });
  }

  private downloadTextureSet(maps: Readonly<BakedTextureSet>, stem: string): void {
    downloadBlob(`${stem}-albedo.png`, maps.albedo.blob);
    downloadBlob(`${stem}-roughness.png`, maps.roughness.blob);
    downloadBlob(`${stem}-normal.png`, maps.normal.blob);
    downloadBlob(`${stem}-height.png`, maps.height.blob);
    downloadBlob(`${stem}-clearcoat.png`, maps.clearcoat.blob);
    downloadBlob(`${stem}-clearcoat-roughness.png`, maps.clearcoatRoughness.blob);
    downloadBlob(`${stem}-metallic.png`, maps.metallic.blob);
    downloadBlob(`${stem}-ao.png`, maps.ao.blob);
    downloadBlob(`${stem}-emissive.png`, maps.emissive.blob);
  }

  private async bakeTextures(): Promise<void> {
    if (!this.beginProductionOperation('bake')) return;
    try {
      const quality = this.renderer.getQualityTierSettings();
      this.shell.setStatus(`Baking PBR maps · ${quality.bakeResolution}²…`);
      this.progress.begin(`Baking PBR maps · ${quality.bakeResolution}²`);
      const maps = await this.renderer.bakeCurrentMaterial(
        this.state.snapshot.physical,
        (channel, index, total) => this.reportBakeChannel(channel, index, total)
      );
      this.downloadTextureSet(maps, EXPORT_CONFIG.textureFileStem);
      this.shell.toast(`Baked 9 maps at ${maps.resolution}×${maps.resolution}.`);
    } catch (error) {
      console.error('Texture bake failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    } finally {
      this.progress.finish();
      this.productionOperation = null;
      this.shell.setStatus(this.projectStatus(this.state.snapshot));
    }
  }

  private async exportGlb(): Promise<void> {
    if (!this.beginProductionOperation('export')) return;
    try {
      this.shell.setStatus('Baking material and exporting GLB…');
      this.progress.begin('Exporting GLB');
      this.progress.report('Baking material…', null);
      const blob = await this.renderer.exportCurrentGlb(this.state.snapshot.physical);
      downloadBlob(EXPORT_CONFIG.glbFileName, blob);
      this.shell.toast(`Exported ${EXPORT_CONFIG.glbFileName} · ${(blob.size / BYTES_PER_MIB).toFixed(1)} MiB`);
    } catch (error) {
      console.error('GLB export failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    } finally {
      this.progress.finish();
      this.productionOperation = null;
      this.shell.setStatus(this.projectStatus(this.state.snapshot));
    }
  }

  private reportBakeChannel(channel: BakeChannel, index: number, total: number): void {
    this.progress.report(`Baking ${BAKE_CHANNEL_LABELS[channel]}…`, total === 0 ? null : index / total);
  }

  private beginProductionOperation(operation: ProductionOperation): boolean {
    if (this.productionOperation !== null) {
      const active = this.productionOperation === 'bake'
        ? 'Texture baking'
        : this.productionOperation === 'export'
          ? 'GLB export'
          : 'Tile generation';
      this.shell.toast(`${active} is already running.`, 'error');
      return false;
    }
    this.productionOperation = operation;
    return true;
  }

  private setQualityTier(tier: QualityTier): void {
    this.runSafely(() => {
      const active = this.renderer.setQualityTier(tier);
      const settings = PERFORMANCE_CONFIG.tiers[active];
      this.shell.setQualityTier(tier);
      const label = tier === 'auto' ? `Auto → ${settings.label}` : settings.label;
      this.shell.toast(`${label} quality · bake ${settings.bakeResolution}²`);
    });
  }

  private projectStatus(state: Readonly<ProjectState>): string {
    return `${state.layers.length} layers · ${state.groups.length} groups · ${this.compiler.computeStatus.label}`;
  }

  private scheduleAutosave(state: Readonly<ProjectState>): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    // The clone used to run here, outside the timer, so a slider drag paid a full deep
    // copy of the project on every pointermove while the debounce only protected the
    // write. Keeping the reference and serialising inside the timer means one
    // serialisation per quiet period instead of one clone per event.
    this.pendingAutosaveState = state;
    this.autosaveTimer = window.setTimeout(() => {
      const snapshot = this.pendingAutosaveState;
      this.pendingAutosaveState = null;
      if (snapshot === null) {
        this.autosaveTimer = null;
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        this.autosaveFailureShown = false;
      } catch (error) {
        console.warn('Autosave failed.', error);
        if (!this.autosaveFailureShown) {
          this.shell.toast('Autosave failed. Use Save to keep a project JSON copy.', 'error');
          this.autosaveFailureShown = true;
        }
      }
      this.autosaveTimer = null;
    }, AUTOSAVE_DELAY_MS);
  }

  private runSafely(action: () => void): void {
    try {
      action();
    } catch (error) {
      console.error('Action failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unexpected error.';
  }
}
