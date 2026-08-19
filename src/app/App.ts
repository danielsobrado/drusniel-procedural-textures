import {
  AUTOSAVE_DELAY_MS,
  HISTORY_LIMIT,
  MAX_MODEL_FILE_BYTES,
  MAX_PROJECT_FILE_BYTES,
  OBJECT_PRESETS,
  STORAGE_KEY,
  UI_CONFIG
} from './constants';
import { AppState, createDefaultProject, type StateChangeReason } from './AppState';
import { ImportedFileCache } from './ImportedFileCache';
import { normalizeImportedAssetName, normalizeProject } from './ProjectFile';
import { LabRenderer } from '../engine/LabRenderer';
import { describeImportedMeshes, ModelLoader } from '../engine/ModelLoader';
import { disposeObjectResources } from '../engine/ObjectResources';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { applyPhysicalSettings } from '../materials/PhysicalMaterial';
import type { EnvironmentPreset, LayerKind, ProjectState } from '../materials/types';
import { Inspector } from '../ui/Inspector';
import { LayerStrip } from '../ui/LayerStrip';
import { LibraryPanel } from '../ui/LibraryPanel';
import { RadialMenu, type RadialCommand } from '../ui/RadialMenu';
import { Shell } from '../ui/Shell';
import { downloadDataUrl, downloadText } from '../utils/download';

const BYTES_PER_MIB = 1024 * 1024;
const IMPORT_CACHE_ENTRY_LIMIT = HISTORY_LIMIT + 1;
const MODEL_EXTENSIONS = new Set(['glb', 'gltf']);

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
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    return serialized === null ? createDefaultProject() : normalizeProject(JSON.parse(serialized));
  } catch (error) {
    console.warn('Ignoring invalid autosaved project.', error);
    return createDefaultProject();
  }
}

export class App {
  private readonly shell: Shell;
  private readonly state: AppState;
  private readonly compiler = new MaterialCompiler();
  private readonly renderer: LabRenderer;
  private readonly modelLoader = new ModelLoader();
  private readonly library: LibraryPanel;
  private readonly inspector: Inspector;
  private readonly layers: LayerStrip;
  private readonly radial: RadialMenu;
  private readonly importedFiles = new ImportedFileCache(IMPORT_CACHE_ENTRY_LIMIT, MAX_MODEL_FILE_BYTES);
  private autosaveTimer: number | null = null;
  private autosaveFailureShown = false;
  private activeImportedName: string | null = null;
  private suppressImportedRestore = false;
  private projectImportSequence = 0;
  private environmentLoadSequence = 0;

  public constructor(root: HTMLElement) {
    this.shell = new Shell(root);
    this.state = new AppState(loadInitialProject());
    this.renderer = new LabRenderer(this.shell.elements.viewport, this.compiler);
    this.renderer.setMeshSelectionCallback((id) => this.state.selectMesh(id));

    this.library = new LibraryPanel(this.shell.elements.library, {
      onObject: (preset) => this.runSafely(() => this.state.setObjectPreset(preset)),
      onPreset: (preset) => this.runSafely(() => this.state.applyPreset(preset)),
      onImport: () => this.shell.elements.modelInput.click()
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

    this.radial = new RadialMenu(this.shell.elements.radial, (command) => this.handleRadialCommand(command));
    this.state.subscribe((state, reason) => this.handleStateChange(state, reason));
    this.bindCommands();
    this.bindFiles();
    this.bindViewportGestures();
    this.bindKeyboard();
    this.syncAll(this.state.snapshot);
  }

  private handleStateChange(state: Readonly<ProjectState>, reason: StateChangeReason): void {
    if (reason === 'project' || reason === 'environment') {
      this.environmentLoadSequence += 1;
    }

    if (reason === 'layers' || reason === 'groups' || reason === 'project') {
      this.syncMaterial(state);
    } else if (reason === 'wireframe') {
      this.compiler.sync(state.layers, state.groups, state.wireframe);
    } else if (reason === 'physical') {
      applyPhysicalSettings(this.compiler.material, state.physical);
    }

    if (
      reason === 'layers' || reason === 'groups' || reason === 'selection' ||
      reason === 'mesh' || reason === 'environment' || reason === 'project'
    ) {
      this.layers.render(state);
      this.inspector.render(state);
    } else if (reason === 'background' || reason === 'wireframe' || reason === 'physical') {
      this.inspector.render(state);
    }

    if (reason === 'object' || reason === 'project') {
      this.syncObject(state);
      this.library.render(state);
    } else if (reason === 'mesh') {
      this.renderer.setMeshAssignments(state.meshAssignments);
      this.renderer.setSelectedMesh(state.selectedMeshId);
    }

    if (reason === 'background' || reason === 'project') this.renderer.setBackground(state.background);
    if (reason === 'environment' || reason === 'project') {
      this.renderer.setEnvironment(state.environment, state.environmentAssetName);
    }

    this.shell.setStatus(`${state.layers.length} layers · ${state.groups.length} groups · Physical`);
    this.scheduleAutosave(state);
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
    this.shell.setStatus(`${state.layers.length} layers · ${state.groups.length} groups · Physical`);
  }

  private syncMaterial(state: Readonly<ProjectState>): void {
    this.compiler.sync(state.layers, state.groups, state.wireframe);
    applyPhysicalSettings(this.compiler.material, state.physical);
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
    this.shell.onCommand('frame', () => this.renderer.frameSelection());
    this.shell.onCommand('wireframe', () => this.state.toggleWireframe());
    this.shell.onCommand('snapshot', () => this.runSafely(() => {
      downloadDataUrl('procedural-texture-preview.png', this.renderer.capturePng());
      this.shell.toast('Preview PNG saved.');
    }));
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

      try {
        this.importedFiles.remember(assetName, files);
      } catch (error) {
        disposeObjectResources(model);
        throw error;
      }

      const meshes = describeImportedMeshes(model);
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
      this.shell.setStatus(`${this.state.snapshot.layers.length} layers · Physical`);
    } catch (error) {
      console.error('Model restore failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.shell.setStatus('Restore failed');
    }
  }

  private async importEnvironment(file: File): Promise<void> {
    const sequence = ++this.environmentLoadSequence;
    try {
      this.shell.setStatus(`Loading ${file.name}…`);
      const loaded = await this.renderer.loadEnvironmentHdr(file);
      if (!loaded || sequence !== this.environmentLoadSequence) return;
      this.state.setEnvironment('custom', file.name);
      this.shell.toast(`Loaded HDR environment ${file.name}`);
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
        this.shell.toast(`Opened ${file.name}. Re-import ${normalizedProject.importedAssetName} if it is not cached.`);
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

  private scheduleAutosave(state: Readonly<ProjectState>): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    const snapshot = structuredClone(state);
    this.autosaveTimer = window.setTimeout(() => {
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
