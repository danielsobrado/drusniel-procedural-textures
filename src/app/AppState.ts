import {
  DEFAULT_BACKGROUND,
  DEFAULT_OBJECT,
  DEFAULT_PHYSICAL,
  HISTORY_LIMIT,
  MAX_LAYERS
} from './constants';
import type {
  MaterialLayer,
  MaterialPreset,
  ObjectPreset,
  PhysicalSettings,
  ProjectState
} from '../materials/types';
import { createId } from '../utils/ids';

export type StateChangeReason =
  | 'project'
  | 'layers'
  | 'selection'
  | 'object'
  | 'viewport';

export type StateListener = (
  state: Readonly<ProjectState>,
  reason: StateChangeReason
) => void;

function cloneProject(project: ProjectState): ProjectState {
  return structuredClone(project);
}

function cloneLayer(layer: MaterialLayer): MaterialLayer {
  return { ...layer, id: createId('layer') };
}

export function createDefaultLayer(kind: MaterialLayer['kind']): MaterialLayer {
  const names: Record<MaterialLayer['kind'], string> = {
    base: 'Base color',
    fbm: 'FBM noise',
    cellular: 'Cellular',
    ridges: 'Ridges',
    spots: 'Spots',
    veins: 'Veins',
    gradient: 'Gradient'
  };

  const colors: Record<MaterialLayer['kind'], [string, string]> = {
    base: ['#343941', '#9ba5b2'],
    fbm: ['#2a3037', '#b0bac4'],
    cellular: ['#27313a', '#91a4b6'],
    ridges: ['#30343b', '#d2d8df'],
    spots: ['#15191e', '#9eb2c3'],
    veins: ['#252a31', '#e5e9ed'],
    gradient: ['#20252b', '#a6b3c0']
  };

  return {
    id: createId('layer'),
    name: names[kind],
    kind,
    enabled: true,
    blendMode: kind === 'base' ? 'normal' : 'overlay',
    opacity: kind === 'base' ? 1 : 0.55,
    scale: kind === 'base' ? 1 : 4,
    strength: 1,
    seed: Math.floor(Math.random() * 97) + 1,
    colorA: colors[kind][0],
    colorB: colors[kind][1],
    roughness: kind === 'base' ? 0.22 : 0,
    displacement: kind === 'base' ? 0 : 0.025
  };
}

export function createDefaultProject(): ProjectState {
  const base = createDefaultLayer('base');
  const noise = createDefaultLayer('fbm');
  noise.name = 'Surface variation';
  noise.opacity = 0.38;
  noise.scale = 3.2;
  noise.displacement = 0.035;

  return {
    version: 1,
    selectedObject: DEFAULT_OBJECT,
    selectedLayerId: noise.id,
    importedAssetName: null,
    background: DEFAULT_BACKGROUND,
    wireframe: false,
    physical: { ...DEFAULT_PHYSICAL },
    layers: [base, noise]
  };
}

export class AppState {
  private project: ProjectState;
  private readonly listeners = new Set<StateListener>();
  private readonly undoStack: ProjectState[] = [];
  private readonly redoStack: ProjectState[] = [];

  public constructor(initialProject: ProjectState = createDefaultProject()) {
    this.project = cloneProject(initialProject);
  }

  public get snapshot(): Readonly<ProjectState> {
    return this.project;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public addLayer(kind: MaterialLayer['kind']): void {
    if (this.project.layers.length >= MAX_LAYERS) {
      throw new Error(`A material can contain at most ${MAX_LAYERS} layers.`);
    }

    this.commit();
    const layer = createDefaultLayer(kind);
    this.project.layers.push(layer);
    this.project.selectedLayerId = layer.id;
    this.emit('layers');
  }

  public updateLayer(id: string, patch: Partial<MaterialLayer>): void {
    const index = this.project.layers.findIndex((layer) => layer.id === id);
    if (index < 0) {
      return;
    }

    this.commit();
    this.project.layers[index] = {
      ...this.project.layers[index],
      ...patch,
      id
    };
    this.emit('layers');
  }

  public removeLayer(id: string): void {
    if (this.project.layers.length <= 1) {
      throw new Error('A material must keep at least one layer.');
    }

    const index = this.project.layers.findIndex((layer) => layer.id === id);
    if (index < 0) {
      return;
    }

    this.commit();
    this.project.layers.splice(index, 1);

    if (this.project.selectedLayerId === id) {
      this.project.selectedLayerId =
        this.project.layers[Math.min(index, this.project.layers.length - 1)]?.id ?? null;
    }

    this.emit('layers');
  }

  public duplicateLayer(id: string): void {
    if (this.project.layers.length >= MAX_LAYERS) {
      throw new Error(`A material can contain at most ${MAX_LAYERS} layers.`);
    }

    const index = this.project.layers.findIndex((layer) => layer.id === id);
    const source = this.project.layers[index];
    if (index < 0 || source === undefined) {
      return;
    }

    this.commit();
    const duplicate = cloneLayer(source);
    duplicate.name = `${source.name} copy`;
    this.project.layers.splice(index + 1, 0, duplicate);
    this.project.selectedLayerId = duplicate.id;
    this.emit('layers');
  }

  public reorderLayer(id: string, targetIndex: number): void {
    const sourceIndex = this.project.layers.findIndex((layer) => layer.id === id);
    if (sourceIndex < 0) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(targetIndex, this.project.layers.length - 1));
    if (sourceIndex === clampedIndex) {
      return;
    }

    this.commit();
    const [layer] = this.project.layers.splice(sourceIndex, 1);
    if (layer !== undefined) {
      this.project.layers.splice(clampedIndex, 0, layer);
    }
    this.emit('layers');
  }

  public selectLayer(id: string | null): void {
    if (id !== null && !this.project.layers.some((layer) => layer.id === id)) {
      return;
    }

    this.project.selectedLayerId = id;
    this.emit('selection');
  }

  public applyPreset(preset: MaterialPreset): void {
    this.commit();
    const layers = preset.layers.slice(0, MAX_LAYERS).map(cloneLayer);
    this.project.layers = layers;
    this.project.selectedLayerId = layers.at(-1)?.id ?? null;
    this.emit('layers');
  }

  public setObjectPreset(preset: ObjectPreset): void {
    if (this.project.selectedObject === preset && this.project.importedAssetName === null) {
      return;
    }

    this.commit();
    this.project.selectedObject = preset;
    this.project.importedAssetName = null;
    this.emit('object');
  }

  public setImportedAsset(name: string): void {
    this.commit();
    this.project.importedAssetName = name;
    this.emit('object');
  }

  public setBackground(color: string): void {
    if (this.project.background === color) {
      return;
    }

    this.commit();
    this.project.background = color;
    this.emit('viewport');
  }

  public setWireframe(enabled: boolean): void {
    if (this.project.wireframe === enabled) {
      return;
    }

    this.commit();
    this.project.wireframe = enabled;
    this.emit('viewport');
  }

  public setPhysical(patch: Partial<PhysicalSettings>): void {
    this.commit();
    this.project.physical = {
      ...this.project.physical,
      ...patch
    };
    this.emit('viewport');
  }

  public toggleWireframe(): void {
    this.setWireframe(!this.project.wireframe);
  }

  public replaceProject(project: ProjectState): void {
    this.validateProject(project);
    this.commit();
    this.project = cloneProject(project);
    this.emit('project');
  }

  public undo(): boolean {
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return false;
    }

    this.redoStack.push(cloneProject(this.project));
    this.project = previous;
    this.emit('project');
    return true;
  }

  public redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) {
      return false;
    }

    this.undoStack.push(cloneProject(this.project));
    this.project = next;
    this.emit('project');
    return true;
  }

  private commit(): void {
    this.undoStack.push(cloneProject(this.project));
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  private emit(reason: StateChangeReason): void {
    for (const listener of this.listeners) {
      listener(this.project, reason);
    }
  }

  private validateProject(project: ProjectState): void {
    if (project.version !== 1) {
      throw new Error(`Unsupported project version: ${String(project.version)}`);
    }

    if (!Array.isArray(project.layers) || project.layers.length === 0) {
      throw new Error('Project material must contain at least one layer.');
    }

    if (project.layers.length > MAX_LAYERS) {
      throw new Error(`Project exceeds the ${MAX_LAYERS} layer limit.`);
    }

    if (project.physical === undefined) {
      throw new Error('Project is missing physical material settings.');
    }
  }
}
