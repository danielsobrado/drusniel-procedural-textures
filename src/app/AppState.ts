import {
  DEFAULT_BACKGROUND,
  DEFAULT_ENVIRONMENT,
  DEFAULT_OBJECT,
  DEFAULT_PHYSICAL,
  HISTORY_COALESCE_MS,
  HISTORY_LIMIT,
  LAYER_KINDS,
  MAX_GROUPS,
  MAX_LAYERS
} from './constants';
import {
  MAX_GROUP_NAME_LENGTH,
  MAX_LAYER_NAME_LENGTH,
  normalizeBackgroundColor,
  normalizeEnvironment,
  normalizeImportedAssetName,
  normalizeMaterialGroup,
  normalizeMaterialLayer,
  normalizeObjectPreset,
  normalizePhysicalSettings,
  normalizeProject
} from './ProjectFile';
import type {
  EnvironmentPreset,
  ImportedMeshTarget,
  MaterialGroup,
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
  | 'groups'
  | 'selection'
  | 'mesh'
  | 'object'
  | 'environment'
  | 'background'
  | 'wireframe'
  | 'physical';

export type StateListener = (
  state: Readonly<ProjectState>,
  reason: StateChangeReason
) => void;

const CONTINUOUS_LAYER_FIELDS = new Set<keyof MaterialLayer>([
  'name', 'opacity', 'scale', 'strength', 'seed', 'colorA', 'colorB',
  'roughness', 'displacement', 'maskStrength'
]);
const CONTINUOUS_GROUP_FIELDS = new Set<keyof MaterialGroup>(['name', 'opacity']);
const COPY_SUFFIX = ' copy';
const LAYER_KIND_IDS = new Set<MaterialLayer['kind']>(LAYER_KINDS.map((item) => item.id));

function cloneProject(project: ProjectState): ProjectState {
  return structuredClone(project);
}

function duplicateLayerName(name: string): string {
  const prefixLength = Math.max(MAX_LAYER_NAME_LENGTH - COPY_SUFFIX.length, 0);
  return `${name.slice(0, prefixLength)}${COPY_SUFFIX}`;
}

function patchChanges<T extends object>(current: T, patch: Partial<T>): boolean {
  return Object.entries(patch).some(([key, value]) => current[key as keyof T] !== value);
}

function patchKey(prefix: string, patch: object): string {
  return `${prefix}:${Object.keys(patch).sort().join(',')}`;
}

function layerCoalesceKey(id: string, patch: Partial<MaterialLayer>): string | undefined {
  const keys = Object.keys(patch) as Array<keyof MaterialLayer>;
  return keys.length > 0 && keys.every((key) => CONTINUOUS_LAYER_FIELDS.has(key))
    ? patchKey(`layer:${id}`, patch)
    : undefined;
}

function groupCoalesceKey(id: string, patch: Partial<MaterialGroup>): string | undefined {
  const keys = Object.keys(patch) as Array<keyof MaterialGroup>;
  return keys.length > 0 && keys.every((key) => CONTINUOUS_GROUP_FIELDS.has(key))
    ? patchKey(`group:${id}`, patch)
    : undefined;
}

function defaultChannel(kind: MaterialLayer['kind']): MaterialLayer['channel'] {
  if (kind === 'wet-film') {
    return 'clearcoat';
  }
  if (kind === 'sss') {
    return 'sss';
  }
  if (kind === 'vessels') {
    return 'color';
  }
  return 'surface';
}

export function createDefaultLayer(kind: MaterialLayer['kind']): MaterialLayer {
  if (!LAYER_KIND_IDS.has(kind)) {
    throw new Error(`Unsupported layer kind: ${String(kind)}.`);
  }

  const names: Record<MaterialLayer['kind'], string> = {
    base: 'Base color',
    fbm: 'FBM noise',
    cellular: 'Cellular',
    ridges: 'Ridges',
    spots: 'Spots',
    veins: 'Veins',
    gradient: 'Gradient',
    vessels: 'Branching vessels',
    'wet-film': 'Wet film',
    sss: 'Subsurface tissue'
  };

  const colors: Record<MaterialLayer['kind'], [string, string]> = {
    base: ['#343941', '#9ba5b2'],
    fbm: ['#2a3037', '#b0bac4'],
    cellular: ['#27313a', '#91a4b6'],
    ridges: ['#30343b', '#d2d8df'],
    spots: ['#15191e', '#9eb2c3'],
    veins: ['#252a31', '#e5e9ed'],
    gradient: ['#20252b', '#a6b3c0'],
    vessels: ['#742a33', '#c26062'],
    'wet-film': ['#8f9aa4', '#f8fbff'],
    sss: ['#e99b4a', '#bd3e48']
  };

  return {
    id: createId('layer'),
    name: names[kind],
    kind,
    enabled: true,
    blendMode: kind === 'base' ? 'normal' : 'overlay',
    channel: defaultChannel(kind),
    opacity: kind === 'base' ? 1 : 0.55,
    scale: kind === 'base' ? 1 : 4,
    strength: 1,
    seed: Math.floor(Math.random() * 97) + 1,
    colorA: colors[kind][0],
    colorB: colors[kind][1],
    roughness: kind === 'base' ? 0.22 : kind === 'wet-film' ? -0.16 : 0,
    displacement: kind === 'base' || kind === 'wet-film' || kind === 'sss' ? 0 : 0.025,
    groupId: null,
    maskSourceLayerId: null,
    maskInvert: false,
    maskStrength: 1
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
    version: 2,
    selectedObject: DEFAULT_OBJECT,
    selectedLayerId: noise.id,
    importedAssetName: null,
    importedMeshes: [],
    selectedMeshId: null,
    meshAssignments: {},
    environment: DEFAULT_ENVIRONMENT,
    environmentAssetName: null,
    background: DEFAULT_BACKGROUND,
    wireframe: false,
    physical: { ...DEFAULT_PHYSICAL },
    groups: [],
    layers: [base, noise]
  };
}

function clonePreset(preset: MaterialPreset): Pick<ProjectState, 'groups' | 'layers'> {
  const groupIdMap = new Map<string, string>();
  const layerIdMap = new Map<string, string>();

  for (const group of preset.groups ?? []) {
    groupIdMap.set(group.id, createId('group'));
  }
  for (const layer of preset.layers) {
    layerIdMap.set(layer.id, createId('layer'));
  }

  const groups = (preset.groups ?? []).map((group) => ({
    ...group,
    id: groupIdMap.get(group.id) ?? createId('group'),
    parentId: group.parentId === null ? null : groupIdMap.get(group.parentId) ?? null
  }));
  const layers = preset.layers.map((layer) => ({
    ...layer,
    id: layerIdMap.get(layer.id) ?? createId('layer'),
    groupId: layer.groupId === null ? null : groupIdMap.get(layer.groupId) ?? null,
    maskSourceLayerId: layer.maskSourceLayerId === null
      ? null
      : layerIdMap.get(layer.maskSourceLayerId) ?? null
  }));

  return { groups, layers };
}

export class AppState {
  private project: ProjectState;
  private readonly listeners = new Set<StateListener>();
  private readonly undoStack: ProjectState[] = [];
  private readonly redoStack: ProjectState[] = [];
  private lastCommitKey: string | null = null;
  private lastCommitAt = 0;

  public constructor(initialProject: ProjectState = createDefaultProject()) {
    this.project = cloneProject(normalizeProject(initialProject));
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
    const layer = normalizeMaterialLayer(createDefaultLayer(kind), this.project.layers.length);
    this.commit();
    this.project.layers.push(layer);
    this.project.selectedLayerId = layer.id;
    this.emit('layers');
  }

  public updateLayer(id: string, patch: Partial<MaterialLayer>): void {
    const index = this.project.layers.findIndex((layer) => layer.id === id);
    const current = this.project.layers[index];
    if (index < 0 || current === undefined) {
      return;
    }
    const candidate = normalizeMaterialLayer({ ...current, ...patch, id }, index);
    const normalized = normalizeProject({
      ...this.project,
      layers: this.project.layers.map((layer, layerIndex) => layerIndex === index ? candidate : layer)
    });
    const next = normalized.layers[index];
    if (next === undefined || !patchChanges(current, next)) {
      return;
    }
    this.commit(layerCoalesceKey(id, patch));
    this.project.layers[index] = next;
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
    for (const layer of this.project.layers) {
      if (layer.maskSourceLayerId === id) {
        layer.maskSourceLayerId = null;
      }
    }
    if (this.project.selectedLayerId === id) {
      this.project.selectedLayerId = this.project.layers[Math.min(index, this.project.layers.length - 1)]?.id ?? null;
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
    const duplicate = normalizeMaterialLayer({
      ...source,
      id: createId('layer'),
      name: duplicateLayerName(source.name),
      maskSourceLayerId: source.maskSourceLayerId === source.id ? null : source.maskSourceLayerId
    }, index + 1);
    this.commit();
    this.project.layers.splice(index + 1, 0, duplicate);
    this.project.selectedLayerId = duplicate.id;
    this.emit('layers');
  }

  public reorderLayer(id: string, targetIndex: number): void {
    const sourceIndex = this.project.layers.findIndex((layer) => layer.id === id);
    if (sourceIndex < 0) {
      return;
    }
    if (!Number.isInteger(targetIndex)) {
      throw new Error('Layer target index must be an integer.');
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
    if (this.project.selectedLayerId === id) {
      return;
    }
    this.project.selectedLayerId = id;
    this.emit('selection');
  }

  public addGroup(layerId: string | null = this.project.selectedLayerId): void {
    if (this.project.groups.length >= MAX_GROUPS) {
      throw new Error(`A material can contain at most ${MAX_GROUPS} groups.`);
    }
    const group = normalizeMaterialGroup({
      id: createId('group'),
      name: `Group ${this.project.groups.length + 1}`.slice(0, MAX_GROUP_NAME_LENGTH),
      parentId: null,
      enabled: true,
      opacity: 1
    }, this.project.groups.length);
    this.commit();
    this.project.groups.push(group);
    const layer = this.project.layers.find((item) => item.id === layerId);
    if (layer !== undefined) {
      layer.groupId = group.id;
    }
    this.emit('groups');
  }

  public updateGroup(id: string, patch: Partial<MaterialGroup>): void {
    const index = this.project.groups.findIndex((group) => group.id === id);
    const current = this.project.groups[index];
    if (index < 0 || current === undefined) {
      return;
    }
    const candidate = normalizeMaterialGroup({ ...current, ...patch, id }, index);
    const normalized = normalizeProject({
      ...this.project,
      groups: this.project.groups.map((group, groupIndex) => groupIndex === index ? candidate : group)
    });
    const next = normalized.groups[index];
    if (next === undefined || !patchChanges(current, next)) {
      return;
    }
    this.commit(groupCoalesceKey(id, patch));
    this.project.groups[index] = next;
    this.emit('groups');
  }

  public removeGroup(id: string): void {
    const index = this.project.groups.findIndex((group) => group.id === id);
    if (index < 0) {
      return;
    }
    this.commit();
    this.project.groups.splice(index, 1);
    for (const group of this.project.groups) {
      if (group.parentId === id) {
        group.parentId = null;
      }
    }
    for (const layer of this.project.layers) {
      if (layer.groupId === id) {
        layer.groupId = null;
      }
    }
    this.emit('groups');
  }

  public applyPreset(preset: MaterialPreset): void {
    const cloned = clonePreset(preset);
    const next = normalizeProject({
      ...this.project,
      groups: cloned.groups.slice(0, MAX_GROUPS),
      layers: cloned.layers.slice(0, MAX_LAYERS),
      selectedLayerId: cloned.layers.at(-1)?.id ?? null,
      physical: { ...DEFAULT_PHYSICAL, ...(preset.physical ?? {}) }
    });
    this.commit();
    this.project = next;
    this.emit('layers');
  }

  public setObjectPreset(preset: ObjectPreset): void {
    const normalizedPreset = normalizeObjectPreset(preset);
    if (this.project.selectedObject === normalizedPreset && this.project.importedAssetName === null) {
      return;
    }
    this.commit();
    this.project.selectedObject = normalizedPreset;
    this.project.importedAssetName = null;
    this.project.importedMeshes = [];
    this.project.selectedMeshId = null;
    this.project.meshAssignments = {};
    this.emit('object');
  }

  public setImportedAsset(name: string, meshes: readonly ImportedMeshTarget[]): void {
    const normalizedName = normalizeImportedAssetName(name);
    const next = normalizeProject({
      ...this.project,
      importedAssetName: normalizedName,
      importedMeshes: meshes,
      selectedMeshId: meshes[0]?.id ?? null,
      meshAssignments: Object.fromEntries(meshes.map((mesh) => [mesh.id, true]))
    });
    this.commit();
    this.project.importedAssetName = next.importedAssetName;
    this.project.importedMeshes = next.importedMeshes;
    this.project.selectedMeshId = next.selectedMeshId;
    this.project.meshAssignments = next.meshAssignments;
    this.emit('object');
  }

  public selectMesh(id: string | null): void {
    if (id !== null && !this.project.importedMeshes.some((mesh) => mesh.id === id)) {
      return;
    }
    if (this.project.selectedMeshId === id) {
      return;
    }
    this.project.selectedMeshId = id;
    this.emit('mesh');
  }

  public setMeshAssignment(id: string, assigned: boolean): void {
    if (!this.project.importedMeshes.some((mesh) => mesh.id === id)) {
      return;
    }
    if (this.project.meshAssignments[id] === assigned) {
      return;
    }
    this.commit();
    this.project.meshAssignments[id] = assigned;
    this.emit('mesh');
  }

  public setEnvironment(environment: EnvironmentPreset, assetName: string | null = null): void {
    const normalized = normalizeEnvironment(environment);
    const normalizedAssetName = assetName === null ? null : normalizeImportedAssetName(assetName);
    if (this.project.environment === normalized && this.project.environmentAssetName === normalizedAssetName) {
      return;
    }
    this.commit();
    this.project.environment = normalized;
    this.project.environmentAssetName = normalizedAssetName;
    this.emit('environment');
  }

  public setBackground(color: string): void {
    const normalizedColor = normalizeBackgroundColor(color);
    if (this.project.background === normalizedColor) {
      return;
    }
    this.commit('viewport:background');
    this.project.background = normalizedColor;
    this.emit('background');
  }

  public setWireframe(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new Error('Wireframe must be a boolean.');
    }
    if (this.project.wireframe === enabled) {
      return;
    }
    this.commit();
    this.project.wireframe = enabled;
    this.emit('wireframe');
  }

  public setPhysical(patch: Partial<PhysicalSettings>): void {
    const next = normalizePhysicalSettings({ ...this.project.physical, ...patch });
    if (!patchChanges(this.project.physical, next)) {
      return;
    }
    this.commit(patchKey('physical', patch));
    this.project.physical = next;
    this.emit('physical');
  }

  public toggleWireframe(): void {
    this.setWireframe(!this.project.wireframe);
  }

  public replaceProject(project: unknown): void {
    const normalized = normalizeProject(project);
    this.commit();
    this.project = cloneProject(normalized);
    this.emit('project');
  }

  public undo(): boolean {
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return false;
    }
    this.redoStack.push(cloneProject(this.project));
    this.project = previous;
    this.resetCoalescing();
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
    this.resetCoalescing();
    this.emit('project');
    return true;
  }

  private commit(coalesceKey?: string): void {
    const now = Date.now();
    const canCoalesce = coalesceKey !== undefined &&
      this.lastCommitKey === coalesceKey &&
      now - this.lastCommitAt <= HISTORY_COALESCE_MS;
    if (!canCoalesce) {
      this.undoStack.push(cloneProject(this.project));
      if (this.undoStack.length > HISTORY_LIMIT) {
        this.undoStack.shift();
      }
    }
    this.redoStack.length = 0;
    this.lastCommitKey = coalesceKey ?? null;
    this.lastCommitAt = now;
  }

  private resetCoalescing(): void {
    this.lastCommitKey = null;
    this.lastCommitAt = 0;
  }

  private emit(reason: StateChangeReason): void {
    for (const listener of this.listeners) {
      listener(this.project, reason);
    }
  }
}
