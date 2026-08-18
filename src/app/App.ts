import { AUTOSAVE_DELAY_MS, OBJECT_PRESETS, STORAGE_KEY } from './constants';
import { AppState, createDefaultProject, type StateChangeReason } from './AppState';
import { LabRenderer } from '../engine/LabRenderer';
import { ModelLoader } from '../engine/ModelLoader';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import type { LayerKind, ProjectState } from '../materials/types';
import { Inspector } from '../ui/Inspector';
import { LayerStrip } from '../ui/LayerStrip';
import { LibraryPanel } from '../ui/LibraryPanel';
import { RadialMenu, type RadialCommand } from '../ui/RadialMenu';
import { Shell } from '../ui/Shell';
import { downloadDataUrl, downloadText } from '../utils/download';

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

    const project = JSON.parse(serialized) as Partial<ProjectState>;
    if (project.version !== 1 || !Array.isArray(project.layers) || project.layers.length === 0) {
      return createDefaultProject();
    }

    return project as ProjectState;
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
  private autosaveTimer: number | null = null;
  private activeImportedName: string | null = null;

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
      onWireframe: (enabled) => this.runSafely(() => this.state.setWireframe(enabled))
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

    this.shell.elements.library.addEventListener('library-filter', () => {
      this.library.render(this.state.snapshot);
    });

    this.syncAll(this.state.snapshot);
  }

  private handleStateChange(
    state: Readonly<ProjectState>,
    reason: StateChangeReason
  ): void {
    this.compiler.sync(state.layers, state.wireframe);

    if (reason === 'layers' || reason === 'selection' || reason === 'project') {
      this.layers.render(state);
      this.inspector.render(state);
    }

    if (reason === 'object' || reason === 'project') {
      this.syncObject(state);
      this.library.render(state);
    }

    if (reason === 'viewport' || reason === 'project') {
      this.renderer.setBackground(state.background);
      this.inspector.render(state);
    }

    this.shell.setStatus(`${state.layers.length} layers · Physical`);
    this.scheduleAutosave(state);
  }

  private syncAll(state: Readonly<ProjectState>): void {
    this.compiler.sync(state.layers, state.wireframe);
    this.renderer.setBackground(state.background);
    this.syncObject(state);
    this.library.render(state);
    this.inspector.render(state);
    this.layers.render(state);
    this.shell.setStatus(`${state.layers.length} layers · Physical`);
  }

  private syncObject(state: Readonly<ProjectState>): void {
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

    if (state.importedAssetName !== null) {
      this.shell.toast('Imported mesh is not embedded in project JSON. Re-import the GLB to restore it.');
    }
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

    viewport.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.radial.open(event.clientX, event.clientY);
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

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        const bounds = this.shell.elements.viewport.getBoundingClientRect();
        this.radial.open(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
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
    try {
      this.shell.setStatus(`Loading ${file.name}…`);
      const model = await this.modelLoader.load(file);
      this.renderer.setImported(model);
      this.activeImportedName = file.name;
      this.state.setImportedAsset(file.name);
      this.shell.setObjectLabel(file.name);
      this.shell.toast(`Imported ${file.name}`);
    } catch (error) {
      console.error('Model import failed.', error);
      this.shell.toast(this.errorMessage(error), 'error');
      this.shell.setStatus('Import failed');
    }
  }

  private async importProject(file: File): Promise<void> {
    try {
      const project = JSON.parse(await file.text()) as ProjectState;
      this.activeImportedName = null;
      this.state.replaceProject(project);
      this.shell.toast(`Opened ${file.name}`);
    } catch (error) {
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
