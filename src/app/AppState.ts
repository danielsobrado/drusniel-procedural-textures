import type { SurfaceGraphDefinition } from '../core/graph/SurfaceGraph';
import {
  setSurfaceGraphExposedValue,
  surfaceGraphExposedValue,
  type SurfaceGraphExposedValue
} from '../core/graph/SurfaceGraphParameters';
import { DEFAULT_PATTERN_SETTINGS } from '../core/material/PatternSettings';
import { mutateGenome } from '../materials/MaterialGenome';
import { compileSurfaceGraph } from '../materials/SurfaceGraphCompiler';
import type {
  EnvironmentPreset,
  GenomeLocks,
  ImportedMeshTarget,
  MaterialGroup,
  MaterialLayer,
  MaterialPreset,
  ObjectPreset,
  PhysicalSettings,
  ProjectState,
  SynthesisSettings
} from '../materials/types';
import { createId } from '../utils/ids';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_ENVIRONMENT,
  DEFAULT_OBJECT,
  DEFAULT_PHYSICAL,
  DEFAULT_SYNTHESIS,
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
  normalizeProject,
  normalizeSynthesisSettings
} from './ProjectFile';

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
  | 'physical'
  | 'synthesis';

export type StateListener = (state: Readonly<ProjectState>, reason: StateChangeReason) => void;

const CONTINUOUS_LAYER_FIELDS = new Set<keyof MaterialLayer>([
  'name', 'opacity', 'scale', 'strength', 'seed', 'colorA', 'colorB',
  'roughness', 'displacement', 'maskStrength', 'pattern'
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
  if (kind === 'wet-film') return 'clearcoat';
  if (kind === 'sss') return 'sss';
  if (kind === 'vessels') return 'color';
  return 'surface';
}

export function createDefaultLayer(kind: MaterialLayer['kind']): MaterialLayer {
  if (!LAYER_KIND_IDS.has(kind)) throw new Error(`Unsupported layer kind: ${String(kind)}.`);

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
    sss: 'Subsurface tissue',
    'reaction-diffusion': 'Reaction diffusion',
    erosion: 'Thermal erosion',
    sdf: 'SDF structure',
    pattern: 'Pattern sampler'
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
    sss: ['#e99b4a', '#bd3e48'],
    'reaction-diffusion': ['#142d31', '#d6a85d'],
    erosion: ['#28231d', '#9b8462'],
    sdf: ['#1c2737', '#b9d7ef'],
    pattern: ['#34312d', '#a89a83']
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
    structureSourceLayerId: null,
    maskInvert: false,
    maskStrength: 1,
    pattern: kind === 'pattern' ? { ...DEFAULT_PATTERN_SETTINGS } : null,
    // normalizeMaterialLayer canonicalizes an absent texture to null, so a freshly created
    // layer has to carry the same key or it will not compare equal to the same layer loaded
    // back from a file.
    texture: null
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
    synthesis: { ...DEFAULT_SYNTHESIS },
    genomeLocks: { color: false, structure: false, roughness: false, scale: false, damage: false },
    graphMode: false,
    surfaceGraph: null,
    groups: [],
    layers: [base, noise]
  };
}

function clonePreset(preset: MaterialPreset): Pick<ProjectState, 'groups' | 'layers'> {
  const groupIdMap = new Map<string, string>();
  const layerIdMap = new Map<string, string>();
  for (const group of preset.groups ?? []) groupIdMap.set(group.id, createId('group'));
  for (const layer of preset.layers) layerIdMap.set(layer.id, createId('layer'));
  const groups = (preset.groups ?? []).map((group) => ({
    ...group,
    id: groupIdMap.get(group.id) ?? createId('group'),
    parentId: group.parentId === null ? null : groupIdMap.get(group.parentId) ?? null
  }));
  const layers = preset.layers.map((layer) => ({
    ...layer,
    pattern: layer.pattern === undefined || layer.pattern === null ? layer.pattern ?? null : { ...layer.pattern },
    id: layerIdMap.get(layer.id) ?? createId('layer'),
    groupId: layer.groupId === null ? null : groupIdMap.get(layer.groupId) ?? null,
    maskSourceLayerId: layer.maskSourceLayerId === null ? null : layerIdMap.get(layer.maskSourceLayerId) ?? null,
    structureSourceLayerId: layer.structureSourceLayerId === null ? null : layerIdMap.get(layer.structureSourceLayerId) ?? null
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

  public get snapshot(): Readonly<ProjectState> { return this.project; }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public addLayer(kind: MaterialLayer['kind']): void {
    if (this.project.layers.length >= MAX_LAYERS) throw new Error(`A material can contain at most ${MAX_LAYERS} layers.`);
    const layer = normalizeMaterialLayer(createDefaultLayer(kind), this.project.layers.length);
    this.commit();
    this.invalidateSurfaceGraph();
    this.project.layers.push(layer);
    this.project.selectedLayerId = layer.id;
    this.emit('layers');
  }

  public updateLayer(id: string, patch: Partial<MaterialLayer>): void {
    const index = this.project.layers.findIndex((layer) => layer.id === id);
    const current = this.project.layers[index];
    if (index < 0 || current === undefined) return;
    const candidate = normalizeMaterialLayer({ ...current, ...patch, id }, index);
    const normalized = normalizeProject({
      ...this.project,
      surfaceGraph: null,
      layers: this.project.layers.map((layer, layerIndex) => layerIndex === index ? candidate : layer)
    });
    const next = normalized.layers[index];
    if (next === undefined || !patchChanges(current, next)) return;
    this.commit(layerCoalesceKey(id, patch));
    this.project.surfaceGraph = null;
    this.project.layers[index] = next;
    this.emit('layers');
  }

  public removeLayer(id: string): void {
    if (this.project.layers.length <= 1) throw new Error('A material must keep at least one layer.');
    const index = this.project.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    this.commit();
    this.invalidateSurfaceGraph();
    this.project.layers.splice(index, 1);
    for (const layer of this.project.layers) {
      if (layer.maskSourceLayerId === id) layer.maskSourceLayerId = null;
      if (layer.structureSourceLayerId === id) layer.structureSourceLayerId = null;
    }
    if (this.project.selectedLayerId === id) {
      this.project.selectedLayerId = this.project.layers[Math.min(index, this.project.layers.length - 1)]?.id ?? null;
    }
    this.emit('layers');
  }

  public duplicateLayer(id: string): void {
    if (this.project.layers.length >= MAX_LAYERS) throw new Error(`A material can contain at most ${MAX_LAYERS} layers.`);
    const index = this.project.layers.findIndex((layer) => layer.id === id);
    const source = this.project.layers[index];
    if (index < 0 || source === undefined) return;
    const duplicate = normalizeMaterialLayer({
      ...source,
      id: createId('layer'),
      name: duplicateLayerName(source.name),
      maskSourceLayerId: source.maskSourceLayerId === source.id ? null : source.maskSourceLayerId
    }, index + 1);
    this.commit();
    this.invalidateSurfaceGraph();
    this.project.layers.splice(index + 1, 0, duplicate);
    this.project.selectedLayerId = duplicate.id;
    this.emit('layers');
  }

  public reorderLayer(id: string, targetIndex: number): void {
    const sourceIndex = this.project.layers.findIndex((layer) => layer.id === id);
    if (sourceIndex < 0) return;
    if (!Number.isInteger(targetIndex)) throw new Error('Layer target index must be an integer.');
    const clampedIndex = Math.max(0, Math.min(targetIndex, this.project.layers.length - 1));
    if (sourceIndex === clampedIndex) return;
    this.commit();
    this.invalidateSurfaceGraph();
    const [layer] = this.project.layers.splice(sourceIndex, 1);
    if (layer !== undefined) this.project.layers.splice(clampedIndex, 0, layer);
    this.emit('layers');
  }

  public selectLayer(id: string | null): void {
    if (id !== null && !this.project.layers.some((layer) => layer.id === id)) return;
    if (this.project.selectedLayerId === id) return;
    this.project.selectedLayerId = id;
    this.emit('selection');
  }

  public addGroup(layerId: string | null = this.project.selectedLayerId): void {
    if (this.project.groups.length >= MAX_GROUPS) throw new Error(`A material can contain at most ${MAX_GROUPS} groups.`);
    const group = normalizeMaterialGroup({
      id: createId('group'),
      name: `Group ${this.project.groups.length + 1}`.slice(0, MAX_GROUP_NAME_LENGTH),
      parentId: null,
      enabled: true,
      opacity: 1
    }, this.project.groups.length);
    this.commit();
    this.invalidateSurfaceGraph();
    this.project.groups.push(group);
    const layer = this.project.layers.find((item) => item.id === layerId);
    if (layer !== undefined) layer.groupId = group.id;
    this.emit('groups');
  }

  public updateGroup(id: string, patch: Partial<MaterialGroup>): void {
    const index = this.project.groups.findIndex((group) => group.id === id);
    const current = this.project.groups[index];
    if (index < 0 || current === undefined) return;
    const candidate = normalizeMaterialGroup({ ...current, ...patch, id }, index);
    const normalized = normalizeProject({
      ...this.project,
      surfaceGraph: null,
      groups: this.project.groups.map((group, groupIndex) => groupIndex === index ? candidate : group)
    });
    const next = normalized.groups[index];
    if (next === undefined || !patchChanges(current, next)) return;
    this.commit(groupCoalesceKey(id, patch));
    this.project.surfaceGraph = null;
    this.project.groups[index] = next;
    this.emit('groups');
  }

  public removeGroup(id: string): void {
    const index = this.project.groups.findIndex((group) => group.id === id);
    if (index < 0) return;
    this.commit();
    this.invalidateSurfaceGraph();
    this.project.groups.splice(index, 1);
    for (const group of this.project.groups) if (group.parentId === id) group.parentId = null;
    for (const layer of this.project.layers) if (layer.groupId === id) layer.groupId = null;
    this.emit('groups');
  }

  public applyPreset(preset: MaterialPreset): void {
    const graphCompilation = preset.graph === undefined
      ? null
      : compileSurfaceGraph(structuredClone(preset.graph));
    const material = graphCompilation === null ? clonePreset(preset) : graphCompilation;
    const groups = material.groups.slice(0, MAX_GROUPS);
    const layers = material.layers.slice(0, MAX_LAYERS);
    const next = normalizeProject({
      ...this.project,
      groups,
      layers,
      selectedLayerId: layers.at(-1)?.id ?? null,
      physical: { ...DEFAULT_PHYSICAL, ...(preset.physical ?? {}) },
      synthesis: { ...DEFAULT_SYNTHESIS, ...(preset.synthesis ?? {}) },
      surfaceGraph: graphCompilation?.graph ?? null
    });
    this.commit();
    this.project = next;
    this.emit('layers');
  }

  public setSurfaceGraphParameter(id: string, value: SurfaceGraphExposedValue): void {
    const current = this.project.surfaceGraph;
    if (current === null || current === undefined) return;
    const graph = setSurfaceGraphExposedValue(current, id, value);
    if (surfaceGraphExposedValue(current, id) === surfaceGraphExposedValue(graph, id)) return;
    this.applySurfaceGraph(graph, `surface-graph:${id}`);
  }

  public setSurfaceGraph(graph: Readonly<SurfaceGraphDefinition>, coalesceKey?: string): void {
    const current = this.project.surfaceGraph;
    if (current === null || current === undefined) throw new Error('The current material does not have an authored surface graph.');
    if (JSON.stringify(current) === JSON.stringify(graph)) return;
    this.applySurfaceGraph(graph, coalesceKey);
  }

  public setObjectPreset(preset: ObjectPreset): void {
    const normalizedPreset = normalizeObjectPreset(preset);
    if (this.project.selectedObject === normalizedPreset && this.project.importedAssetName === null) return;
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
    const restoringSameAsset = this.project.importedAssetName === normalizedName;
    const meshIds = new Set(meshes.map((mesh) => mesh.id));
    const nextAssignments = Object.fromEntries(meshes.map((mesh) => [
      mesh.id,
      restoringSameAsset ? this.project.meshAssignments[mesh.id] ?? true : true
    ]));
    const nextSelection = restoringSameAsset && this.project.selectedMeshId !== null && meshIds.has(this.project.selectedMeshId)
      ? this.project.selectedMeshId
      : meshes[0]?.id ?? null;
    const next = normalizeProject({
      ...this.project,
      importedAssetName: normalizedName,
      importedMeshes: meshes,
      selectedMeshId: nextSelection,
      meshAssignments: nextAssignments
    });
    this.commit();
    this.project.importedAssetName = next.importedAssetName;
    this.project.importedMeshes = next.importedMeshes;
    this.project.selectedMeshId = next.selectedMeshId;
    this.project.meshAssignments = next.meshAssignments;
    this.emit('object');
  }

  public selectMesh(id: string | null): void {
    if (id !== null && !this.project.importedMeshes.some((mesh) => mesh.id === id)) return;
    if (this.project.selectedMeshId === id) return;
    this.project.selectedMeshId = id;
    this.emit('mesh');
  }

  public setMeshAssignment(id: string, assigned: boolean): void {
    if (!this.project.importedMeshes.some((mesh) => mesh.id === id)) return;
    if (this.project.meshAssignments[id] === assigned) return;
    this.commit();
    this.project.meshAssignments[id] = assigned;
    this.emit('mesh');
  }

  public setEnvironment(environment: EnvironmentPreset, assetName: string | null = null): void {
    const normalized = normalizeEnvironment(environment);
    const normalizedAssetName = normalized === 'custom' && assetName !== null ? normalizeImportedAssetName(assetName) : null;
    if (this.project.environment === normalized && this.project.environmentAssetName === normalizedAssetName) return;
    this.commit();
    this.project.environment = normalized;
    this.project.environmentAssetName = normalizedAssetName;
    this.emit('environment');
  }

  public setBackground(color: string): void {
    const normalizedColor = normalizeBackgroundColor(color);
    if (this.project.background === normalizedColor) return;
    this.commit('viewport:background');
    this.project.background = normalizedColor;
    this.emit('background');
  }

  public setWireframe(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Wireframe must be a boolean.');
    if (this.project.wireframe === enabled) return;
    this.commit();
    this.project.wireframe = enabled;
    this.emit('wireframe');
  }

  public setPhysical(patch: Partial<PhysicalSettings>): void {
    const next = normalizePhysicalSettings({ ...this.project.physical, ...patch });
    if (!patchChanges(this.project.physical, next)) return;
    this.commit(patchKey('physical', patch));
    this.project.physical = next;
    this.emit('physical');
  }

  public setSynthesis(patch: Partial<SynthesisSettings>): void {
    const next = normalizeSynthesisSettings({ ...this.project.synthesis, ...patch });
    if (!patchChanges(this.project.synthesis, next)) return;
    this.commit(patchKey('synthesis', patch));
    this.project.synthesis = next;
    this.emit('synthesis');
  }

  public setGenomeLock(key: keyof GenomeLocks, enabled: boolean): void {
    if (this.project.genomeLocks[key] === enabled) return;
    this.commit();
    this.project.genomeLocks[key] = enabled;
    this.emit('synthesis');
  }

  public setGraphMode(enabled: boolean): void {
    if (this.project.graphMode === enabled) return;
    this.commit();
    this.project.graphMode = enabled;
    this.emit('synthesis');
  }

  public mutateMaterial(seed = Math.floor(Math.random() * 0x7fffffff)): void {
    const genome = mutateGenome(this.project.layers, this.project.synthesis, this.project.genomeLocks, seed);
    const next = normalizeProject({ ...this.project, surfaceGraph: null, layers: genome.layers, synthesis: genome.synthesis });
    this.commit();
    this.project = next;
    this.emit('synthesis');
  }

  public mutateMaterialVariant(variant: number): void {
    if (!Number.isInteger(variant) || variant < 0 || variant > 5) throw new Error('Material evolution variant must be between 0 and 5.');
    const fingerprint = JSON.stringify({ layers: this.project.layers, synthesis: this.project.synthesis });
    let seed = 2166136261;
    for (let index = 0; index < fingerprint.length; index += 1) {
      seed ^= fingerprint.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
    this.mutateMaterial((seed + Math.imul(variant + 1, 0x9e3779b1)) >>> 0);
  }

  public toggleWireframe(): void { this.setWireframe(!this.project.wireframe); }

  public replaceProject(project: unknown): void {
    const normalized = normalizeProject(project);
    this.commit();
    this.project = cloneProject(normalized);
    this.emit('project');
  }

  public undo(): boolean {
    const previous = this.undoStack.pop();
    if (previous === undefined) return false;
    this.redoStack.push(cloneProject(this.project));
    this.project = previous;
    this.resetCoalescing();
    this.emit('project');
    return true;
  }

  public redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(cloneProject(this.project));
    this.project = next;
    this.resetCoalescing();
    this.emit('project');
    return true;
  }

  private applySurfaceGraph(graph: Readonly<SurfaceGraphDefinition>, coalesceKey?: string): void {
    const compiled = compileSurfaceGraph(structuredClone(graph));
    const requestedSelection = this.project.selectedLayerId;
    const selectedName = requestedSelection === null
      ? undefined
      : this.project.layers.find((layer) => layer.id === requestedSelection)?.name;
    const selectedLayerId = requestedSelection !== null && compiled.layers.some((layer) => layer.id === requestedSelection)
      ? requestedSelection
      : selectedName === undefined
        ? compiled.layers.at(-1)?.id ?? null
        : compiled.layers.find((layer) => layer.name === selectedName)?.id ?? compiled.layers.at(-1)?.id ?? null;
    const next = normalizeProject({
      ...this.project,
      surfaceGraph: compiled.graph,
      groups: compiled.groups,
      layers: compiled.layers,
      selectedLayerId
    });
    this.commit(coalesceKey);
    this.project = next;
    this.emit('layers');
  }

  private invalidateSurfaceGraph(): void {
    this.project.surfaceGraph = null;
  }

  private commit(coalesceKey?: string): void {
    const now = Date.now();
    const canCoalesce = coalesceKey !== undefined && this.lastCommitKey === coalesceKey && now - this.lastCommitAt <= HISTORY_COALESCE_MS;
    if (!canCoalesce) {
      this.undoStack.push(cloneProject(this.project));
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
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
    for (const listener of this.listeners) listener(this.project, reason);
  }
}
