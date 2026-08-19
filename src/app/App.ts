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
import { ModelLoader } from '../engine/ModelLoader';
import { disposeObjectResources } from '../engine/ObjectResources';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { applyPhysicalSettings } from '../materials/PhysicalMaterial';
import type { LayerKind, ProjectState } from '../materials/types';
import { Inspector } from '../ui/Inspector';
import { LayerStrip } from '../ui/LayerStrip';
import { LibraryPanel } from '../ui/LibraryPanel';
import { RadialMenu, type RadialCommand } from '../ui/RadialMenu';
import { Shell } from '../ui/Shell';
import { downloadDataUrl, downloadText } from '../utils/download';

const BYTES_PER_MIB = 1024 * 1024;

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

function loadInitialProject(): ProjectState {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized === null) {
      return createDefaultProject();
    }

    return normalizeProject(JSON.parse(serialized));
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
  private readonly importedFiles = new ImportedFileCache(HISTORY_LIMIT, MAX_MODEL_FILE_BYTES);
  private autosaveTimer: number | null = null;
  private activeImportedName: string | null = null;
  private suppressImportedRestore = false;
  private projectImportSequence = 0;

  public constructor(root: HTMLElement) {
    this.shell = new Shell(root);
    this.state = new AppState(loadInitialProject());
    this.renderer = new LabRenderer(this.shell.elements.viewport, this.compiler);

    this.library = new LibraryPanel(this.shell.elements.library, {
      onObject: (preset) => this.runSafely(() => this.state.setObjectPreset(preset)),
      onPreset: (preset) => this.runSafely(() => this.state.applyPreset(preset)),
      onImport: () => this.shell.elements.modelInput.click()
    });

    this.inspector = new Inspector(this.shell.elements.inspector, {
      onLayerPatch: (id, patch) => this.runSafely(() => this.state.updateLayer(id, patch)),
      onDuplicate: (id) => this.runSafely(() => this.state.duplicateLayer(id)),
      onRemove: (id) => this.runSafely(() => this.state.removeLayer(id)),
      onBackground: (color) => this.runSafely(() => this.state.setBackground(color)),
      onWireframe: (enabled) => this.runSafely(() => this.state.setWireframe(enabled)),
      onPhysical: (patch) => this.runSafely(() => this.state.setPhysical(patch))
    });

    this.layers = new LayerStrip(this.shell.elements.layers, {
      onAdd: (kind) => this.runSafely(() => this.state.addLayer(kind)),
      onSelect: (id) => this.state.selectLayer(id),
      onToggle: (id, enabled) => this.runSafely(() => this.state.updateLayer(id, { enabled })),
      onRemove: (id) => this.runSafely(() => this.state.removeLayer(id)),
      onDuplicate: (id) => this.runSafely(() => this.state.duplicateLayer(id)),
      onReorder: (id, targetIndex) => this.runSafely(() => this.state.reorderLayer(id, targetIndex))
    });

    this.radial = new RadialMenu(
      this.shell.elements.radial,
      (command) => this.handleRadialCommand(command)
    );

    this.state.subscribe((state, reason) => this.handleStateChange(state, reason));
    this.bindCommands();
    this.bindFiles();
    this.bindViewportGestures();
    this.bindKeyboard();
    this.syncAll(this.state.snapshot);
  }

  private handleStateChange(
    state: Readonly<ProjectState>,
    reason: StateChangeReason
  ): void {
    if (reason === 'layers' || reason === 'project') {
      this.syncMaterial(state);
    } else if (reason === 'wireframe') {
      this.compiler.sync(state.layers, state.wireframe);
    } else if (reason === 'physical') {
      applyPhysicalSettings(this.compiler.material, state.physical);
    }

    if (reason === 'layers' || reason === 'selection' || reason === 'project') {
      this.layers.render(state);
      this.inspector.render(state);
    } else if (
      reason === 'background' ||
      reason === 'wireframe' ||
      reason === 'physical'
    ) {
      this.inspector.render(state);
    }

    if (reason === 'object' || reason === 'project') {
      this.syncObject(state);
      this.library.render(state);
    }

    if (reason === 'background' || reason === 'project') {
      this.renderer.setBackground(state.background);
    }

    this.shell.setStatus(`${state.layers.length} layers · Physical`);
    this.scheduleAutosave(state);
  }

  private syncAll(state: Readonly<ProjectState>): void {
    this.syncMaterial(state);
    this.renderer.setBackground(state.background);
    this.syncObject(state);
    this.library.render(state);
    this.inspector.render(state);
    this.layers.render(state);
    this.shell.setStatus(`${state.layers.length} layers · Physical`);
  }

  private syncMaterial(state: Readonly<ProjectState>): void {
    this.compiler.sync(state.layers, state.wireframe);
    applyPhysicalSettings(this.compiler.material, state.physical);
  }

  private syncObject(state: Readonly<ProjectState>): void {
    this.projectImportSequence += 1;
    this.modelLoader.cancelPending();

    if (
      state.importedAssetName !== null &&
      this.activeImportedName === state.importedAssetName
    ) {
      this.shell.setObjectLabel(state.importedAssetName);
      return;
    }

    this.activeImportedName = null;
    this.renderer.setPrimitive(state.selectedObject);
    const preset = OBJECT_PRESETS.find((item) => item.id === state.selectedObject);
    this.shell.setObjectLabel(preset?.label ?? state.selectedObject);

    if (state.importedAssetName === null) {
      return;
    }

    if (this.suppressImportedRestore) {
      this.shell.toast('Imported mesh is not embedded in project JSON. Re-import the GLB to restore it.');
      return;
    }

    const cached = this.importedFiles.lookup(state.importedAssetName);
    if (cached.status === 'found') {
      void this.restoreImportedModel(cached.file, state.importedAssetName);
      return;
    }

    if (cached.status === 'ambiguous') {
      this.shell.toast('Multiple imported files share this name. Re-import the intended GLB to restore it.');
      return;
    }

    this.shell.toast('Imported mesh is not embedded in project JSON. Re-import the GLB to restore it.');
  }

  private bindCommands(): void {
    this.shell.onCommand('undo', () => {
      if (!this.state.undo()) {
        this.shell.toast('Nothing to undo.');
      }
    });

    this.shell.onCommand('redo', () => {
      if (!this.state.redo()) {
        this.shell.toast('Nothing to redo.');
      }
    });

    this.shell.onCommand('import-model', () => this.shell.elements.modelInput.click());
    this.shell.onCommand('open-project', () => this.shell.elements.projectInput.click());
    this.shell.onCommand('save-project', () => this.exportProject());
    this.shell.onCommand('frame', () => this.renderer.frameSelection());
    this.shell.onCommand('wireframe', () => this.state.toggleWireframe());
    this.shell.onCommand('snapshot', () => {
      downloadDataUrl('procedural-texture-preview.png', this.renderer.capturePng());
      this.shell.toast('Preview PNG saved.');
    });
  }

  private bindFiles(): void {
    this.shell.elements.modelInput.addEventListener('change', () => {
      const file = this.shell.elements.modelInput.files?.[0];
      if (file !== undefined) {
        void this.importModel(file);
      }
      this.shell.elements.modelInput.value = '';
    });

    this.shell.elements.projectInput.addEventListener('change', () => {
      const file = this.shell.elements.projectInput.files?.[0];
      if (file !== undefined) {
        void this.importProject(file);
      }
      this.shell.elements.projectInput.value = '';
    });
  }

  private bindViewportGestures(): void {
    const viewport = this.shell.elements.viewport;
    let rightPress: { pointerId: number; startX: number; startY: number } | null = null;

    viewport.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (event.button !== 2) {
        this.radial.open(event.clientX, event.clientY);
      }
    });

    viewport.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button === 2) {
        rightPress = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY
        };
      }
    });

    viewport.addEventListener('pointermove', (event) => {
      if (rightPress === null || event.pointerId !== rightPress.pointerId) {
        return;
      }

      const distance = Math.hypot(
        event.clientX - rightPress.startX,
        event.clientY - rightPress.startY
      );
      if (distance > UI_CONFIG.radialClickMoveTolerancePx) {
        rightPress = null;
      }
    });

    viewport.addEventListener('pointerup', (event) => {
      if (
        rightPress !== null &&
        event.pointerId === rightPress.pointerId &&
        event.button === 2
      ) {
        this.radial.open(event.clientX, event.clientY);
      }
      rightPress = null;
    });

    viewport.addEventListener('pointercancel', () => {
      rightPress = null;
    });

    viewport.addEventListener('dragenter', (event) => {
      event.preventDefault();
      this.shell.setDragging(true);
    });

    viewport.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });

    viewport.addEventListener('dragleave', (event) => {
      if (event.relatedTarget instanceof Node && viewport.contains(event.relatedTarget)) {
        return;
      }
      this.shell.setDragging(false);
    });

    viewport.addEventListener('drop', (event) => {
      event.preventDefault();
      this.shell.setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        void this.importModel(file);
      }
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.state.redo();
        } else {
          this.state.undo();
        }
        return;
      }

      if (modifier || event.altKey) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        const bounds = this.shell.elements.viewport.getBoundingClientRect();
        this.radial.open(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
          true
        );
      } else if (event.key.toLowerCase() === 'f') {
        this.renderer.frameSelection();
      } else if (event.key.toLowerCase() === 'w') {
        this.state.toggleWireframe();
      }
    });
  }

  private handleRadialCommand(command: RadialCommand): void {
    const layerCommand: Partial<Record<RadialCommand, LayerKind>> = {
      'add-noise': 'fbm',
      'add-cells': 'cellular',
      'add-veins': 'veins'
    };

    const layerKind = layerCommand[command];
    if (layerKind !== undefined) {
      this.runSafely(() => this.state.addLayer(layerKind));
      return;
    }

    if (command === 'sphere') {
      this.state.setObjectPreset('sphere');
    } else if (command === 'torus') {
      this.state.setObjectPreset('torus');
    } else if (command === 'import') {
      this.shell.elements.modelInput.click();
    } else if (command === 'frame') {
      this.renderer.frameSelection();
    } else if (command === 'wireframe') {
      this.state.toggleWireframe();
    }
  }

  private async importModel(file: File): Promise<void> {
    this.projectImportSequence += 1;

    try {
      const assetName = normalizeImportedAssetName(file.name);
      this.shell.setStatus(`Loading ${assetName}…`);
      const model = await this.modelLoader.load(file);
      if (model === null) {
        return;
      }

      this.renderer.setImported(model);
      this.importedFiles.remember(file);
      this.activeImportedName = assetName;
      this.state.setImportedAsset(assetName);
      this.shell.setObjectLabel(assetName);
      this.shell.toast(`Imported ${assetName}`);
    } catch (error) {
      console.error('Model import failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.shell.setStatus('Import failed');
    }
  }

  private async restoreImportedModel(file: File, expectedName: string): Promise<void> {
    try {
      this.shell.setStatus(`Restoring ${expectedName}…`);
      const model = await this.modelLoader.load(file);
      if (model === null) {
        return;
      }

      if (this.state.snapshot.importedAssetName !== expectedName) {
        disposeObjectResources(model);
        return;
      }

      this.renderer.setImported(model);
      this.activeImportedName = expectedName;
      this.shell.setObjectLabel(expectedName);
      this.shell.setStatus(`${this.state.snapshot.layers.length} layers · Physical`);
    } catch (error) {
      console.error('Model restore failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.shell.setStatus('Restore failed');
    }
  }

  private async importProject(file: File): Promise<void> {
    const sequence = ++this.projectImportSequence;
    this.modelLoader.cancelPending();

    try {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        const limitMiB = MAX_PROJECT_FILE_BYTES / BYTES_PER_MIB;
        throw new Error(`Project file exceeds the configured ${limitMiB.toFixed(1)} MiB limit.`);
      }

      const text = await file.text();
      if (sequence !== this.projectImportSequence) {
        return;
      }

      const project = JSON.parse(text) as unknown;
      const normalizedProject = normalizeProject(project);
      this.activeImportedName = null;
      this.suppressImportedRestore = true;
      try {
        this.state.replaceProject(normalizedProject);
      } finally {
        this.suppressImportedRestore = false;
      }
      this.shell.toast(`Opened ${file.name}`);
    } catch (error) {
      if (sequence !== this.projectImportSequence) {
        return;
      }
      console.error('Project import failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
    }
  }

  private exportProject(): void {
    const serialized = JSON.stringify(this.state.snapshot, null, 2);
    downloadText('procedural-texture-lab.json', serialized);
    this.shell.toast('Project JSON saved.');
  }

  private scheduleAutosave(state: Readonly<ProjectState>): void {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
    }

    const snapshot = structuredClone(state);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        console.warn('Autosave failed.', error);
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
