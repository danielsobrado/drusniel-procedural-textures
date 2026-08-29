import {
  BLEND_MODES,
  CONTROL_RANGES,
  ENVIRONMENTS,
  LAYER_CHANNELS,
  LAYER_KINDS,
  MASK_MODES,
  MAX_GROUP_DEPTH
} from '../app/constants';
import { MAX_GROUP_NAME_LENGTH, MAX_LAYER_NAME_LENGTH } from '../app/ProjectFile';
import { SURFACE_GRAPH_NODE_SPEC_BY_KIND } from '../core/graph/SurfaceGraphCatalog';
import {
  surfaceGraphExposedValue,
  type SurfaceGraphExposedValue
} from '../core/graph/SurfaceGraphParameters';
import type {
  SurfaceGraphDefinition,
  SurfaceGraphExposedParameter
} from '../core/graph/SurfaceGraph';
import {
  DEFAULT_PATTERN_SETTINGS,
  GRASS_PATTERN_LIMITS,
  PATTERN_LIMITS,
  TURF_PATTERN_LIMITS,
  type PatternSettings
} from '../core/material/PatternSettings';
import { SURFACE_DESIGNER_CONFIG } from '../config/surfaceDesignerConfig';
import { canReparentGroup } from '../materials/GroupHierarchy';
import { compileMaterialGraph } from '../core/material/MaterialGraph';
import type {
  EnvironmentPreset,
  GenomeLocks,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  ProjectState,
  SynthesisSettings
} from '../materials/types';
import { escapeHtml } from '../utils/html';

export interface InspectorCallbacks {
  onLayerPatch: (id: string, patch: Partial<MaterialLayer>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onGroupAdd: (layerId: string) => void;
  onGroupPatch: (id: string, patch: Partial<MaterialGroup>) => void;
  onGroupRemove: (id: string) => void;
  onBackground: (color: string) => void;
  onWireframe: (enabled: boolean) => void;
  onPhysical: (patch: Partial<PhysicalSettings>) => void;
  onSynthesis: (patch: Partial<SynthesisSettings>) => void;
  onGenomeLock: (key: keyof GenomeLocks, enabled: boolean) => void;
  onMutate: (variant: number) => void;
  onGraphMode: (enabled: boolean) => void;
  onGraphParameter: (id: string, value: SurfaceGraphExposedValue) => void;
  onEnvironment: (environment: EnvironmentPreset) => void;
  onEnvironmentImport: () => void;
  onMeshSelect: (id: string | null) => void;
  onMeshAssigned: (id: string, assigned: boolean) => void;
}

type NumericLayerKey = keyof Pick<
  MaterialLayer,
  'opacity' | 'scale' | 'strength' | 'seed' | 'roughness' | 'displacement' | 'maskStrength'
  | 'maskThreshold' | 'maskSoftness' | 'maskBreakup'
>;

/** Numeric layer fields that live outside the main parameter section. */
const ROUTING_NUMERIC_KEYS: ReadonlySet<string> = new Set([
  'maskStrength', 'maskThreshold', 'maskSoftness', 'maskBreakup'
]);
type PatternNumericKey = Exclude<keyof PatternSettings, 'kind'>;

type NumericField = {
  key: NumericLayerKey;
  label: string;
  min: number;
  max: number;
  step: number;
};

type PatternField = {
  key: PatternNumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
};

type NumericPhysicalKey = Exclude<keyof PhysicalSettings, 'sheenColor' | 'attenuationColor'>;
type ColorPhysicalKey = Extract<keyof PhysicalSettings, 'sheenColor' | 'attenuationColor'>;

type PhysicalField = {
  key: NumericPhysicalKey;
  label: string;
  min: number;
  max: number;
  step: number;
};

const NUMERIC_FIELDS: readonly NumericField[] = [
  { key: 'opacity', label: 'Opacity', ...CONTROL_RANGES.layer.opacity },
  { key: 'scale', label: 'Scale', ...CONTROL_RANGES.layer.scale },
  { key: 'strength', label: 'Strength', ...CONTROL_RANGES.layer.strength },
  { key: 'seed', label: 'Seed', ...CONTROL_RANGES.layer.seed },
  { key: 'roughness', label: 'Roughness Δ', ...CONTROL_RANGES.layer.roughness },
  { key: 'displacement', label: 'Displace', ...CONTROL_RANGES.layer.displacement }
];

const PATTERN_FIELDS: readonly PatternField[] = [
  { key: 'aspect', label: 'Aspect', ...PATTERN_LIMITS.aspect, step: 0.05 },
  { key: 'gap', label: 'Gap', ...PATTERN_LIMITS.gap, step: 0.005 },
  { key: 'roundness', label: 'Roundness', ...PATTERN_LIMITS.roundness, step: 0.01 },
  { key: 'jitter', label: 'Jitter', ...PATTERN_LIMITS.jitter, step: 0.01 },
  { key: 'rotation', label: 'Rotation', ...PATTERN_LIMITS.rotation, step: 0.01 },
  { key: 'offset', label: 'Row offset', ...PATTERN_LIMITS.offset, step: 0.01 },
  { key: 'density', label: 'Density', ...PATTERN_LIMITS.density, step: 0.05 },
  { key: 'edgeWear', label: 'Edge wear', ...PATTERN_LIMITS.edgeWear, step: 0.01 }
];

const VEGETATION_BASE_PATTERN_FIELDS = PATTERN_FIELDS.filter((field) =>
  field.key === 'jitter' || field.key === 'rotation' || field.key === 'density' || field.key === 'edgeWear'
);

const GRASS_PATTERN_FIELDS: readonly PatternField[] = [
  { key: 'bladeLength', label: 'Blade length', ...GRASS_PATTERN_LIMITS.bladeLength, step: 0.01 },
  { key: 'bladeWidth', label: 'Blade width', ...GRASS_PATTERN_LIMITS.bladeWidth, step: 0.002 },
  { key: 'bladeTaper', label: 'Taper', ...GRASS_PATTERN_LIMITS.bladeTaper, step: 0.05 },
  { key: 'bladeBend', label: 'Bend', ...GRASS_PATTERN_LIMITS.bladeBend, step: 0.005 },
  { key: 'bladeCurvature', label: 'Curvature', ...GRASS_PATTERN_LIMITS.bladeCurvature, step: 0.05 },
  { key: 'clumpScale', label: 'Clump scale', ...GRASS_PATTERN_LIMITS.clumpScale, step: 0.05 },
  { key: 'clumpStrength', label: 'Clumping', ...GRASS_PATTERN_LIMITS.clumpStrength, step: 0.01 },
  { key: 'directionality', label: 'Direction', ...GRASS_PATTERN_LIMITS.directionality, step: 0.01 },
  { key: 'dryness', label: 'Dryness', ...GRASS_PATTERN_LIMITS.dryness, step: 0.01 },
  { key: 'tipFade', label: 'Tip fade', ...GRASS_PATTERN_LIMITS.tipFade, step: 0.01 },
  { key: 'rootDarkening', label: 'Root darkening', ...GRASS_PATTERN_LIMITS.rootDarkening, step: 0.01 },
  { key: 'heightJitter', label: 'Length variation', ...GRASS_PATTERN_LIMITS.heightJitter, step: 0.01 },
  { key: 'widthJitter', label: 'Width variation', ...GRASS_PATTERN_LIMITS.widthJitter, step: 0.01 },
  { key: 'leanJitter', label: 'Lean variation', ...GRASS_PATTERN_LIMITS.leanJitter, step: 0.01 }
];

const TURF_PATTERN_FIELDS: readonly PatternField[] = [
  { key: 'fiberLength', label: 'Fiber length', ...TURF_PATTERN_LIMITS.fiberLength, step: 0.01 },
  { key: 'fiberWidth', label: 'Fiber width', ...TURF_PATTERN_LIMITS.fiberWidth, step: 0.002 },
  { key: 'fiberBreakup', label: 'Fiber breakup', ...TURF_PATTERN_LIMITS.fiberBreakup, step: 0.01 },
  { key: 'fiberSoftness', label: 'Fiber softness', ...TURF_PATTERN_LIMITS.fiberSoftness, step: 0.01 },
  { key: 'clumpScale', label: 'Tuft scale', ...GRASS_PATTERN_LIMITS.clumpScale, step: 0.05 },
  { key: 'clumpStrength', label: 'Tuft strength', ...GRASS_PATTERN_LIMITS.clumpStrength, step: 0.01 },
  { key: 'directionality', label: 'Direction', ...GRASS_PATTERN_LIMITS.directionality, step: 0.01 },
  { key: 'dryness', label: 'Dryness', ...GRASS_PATTERN_LIMITS.dryness, step: 0.01 },
  { key: 'rootDarkening', label: 'Root darkening', ...GRASS_PATTERN_LIMITS.rootDarkening, step: 0.01 }
];

const PHYSICAL_FIELDS: readonly PhysicalField[] = [
  { key: 'roughness', label: 'Base roughness', ...CONTROL_RANGES.physical.roughness },
  { key: 'metalness', label: 'Metalness', ...CONTROL_RANGES.physical.metalness },
  { key: 'clearcoat', label: 'Clearcoat', ...CONTROL_RANGES.physical.clearcoat },
  { key: 'clearcoatRoughness', label: 'Coat roughness', ...CONTROL_RANGES.physical.clearcoatRoughness },
  { key: 'specularIntensity', label: 'Specular', ...CONTROL_RANGES.physical.specularIntensity },
  { key: 'ior', label: 'IOR', ...CONTROL_RANGES.physical.ior },
  { key: 'sheen', label: 'Sheen', ...CONTROL_RANGES.physical.sheen },
  { key: 'sheenRoughness', label: 'Sheen roughness', ...CONTROL_RANGES.physical.sheenRoughness },
  { key: 'transmission', label: 'Transmission', ...CONTROL_RANGES.physical.transmission },
  { key: 'thickness', label: 'Thickness', ...CONTROL_RANGES.physical.thickness },
  { key: 'attenuationDistance', label: 'Absorb distance', ...CONTROL_RANGES.physical.attenuationDistance }
];

const SYNTHESIS_FIELDS: ReadonlyArray<{
  key: keyof SynthesisSettings;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'age', label: 'Age', ...CONTROL_RANGES.synthesis.age },
  { key: 'weathering', label: 'Weathering', ...CONTROL_RANGES.synthesis.weathering },
  { key: 'gravity', label: 'Gravity', ...CONTROL_RANGES.synthesis.gravity },
  { key: 'macro', label: 'Macro', ...CONTROL_RANGES.synthesis.macro },
  { key: 'meso', label: 'Meso', ...CONTROL_RANGES.synthesis.meso },
  { key: 'micro', label: 'Micro', ...CONTROL_RANGES.synthesis.micro },
  { key: 'variation', label: 'Variation', ...CONTROL_RANGES.synthesis.variation },
  { key: 'stochasticTiling', label: 'Anti-repeat', ...CONTROL_RANGES.synthesis.stochasticTiling }
];

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function canUseGroupAsParent(
  groupId: string,
  candidateId: string,
  groups: readonly MaterialGroup[]
): boolean {
  return canReparentGroup(groupId, candidateId, groups, MAX_GROUP_DEPTH);
}

function syncOptionLabels(select: HTMLSelectElement | null, labels: ReadonlyMap<string, string>): void {
  if (select === null) return;
  for (const item of Array.from(select.options)) {
    const label = labels.get(item.value);
    if (label !== undefined) item.textContent = label;
  }
}

function surfaceGraphStructureKey(graph: Readonly<SurfaceGraphDefinition> | null | undefined): string {
  if (graph === null || graph === undefined) return '';
  return JSON.stringify({
    id: graph.id,
    name: graph.name,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      position: node.position,
      runtimeKind: node.runtime?.kind ?? null
    })),
    edges: graph.edges,
    exposed: graph.exposed,
    subgraphs: graph.subgraphs.map((subgraph) => ({
      id: subgraph.id,
      name: subgraph.name,
      nodeCount: subgraph.nodes.length,
      edgeCount: subgraph.edges.length
    }))
  });
}

function isSimulationLayer(
  layer: Readonly<MaterialLayer> | undefined
): layer is Readonly<MaterialLayer> {
  return layer?.kind === 'reaction-diffusion' || layer?.kind === 'erosion';
}

export class Inspector {
  private currentLayerId: string | null = null;
  private currentState: Readonly<ProjectState> | null = null;
  private structureKey = '';

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: InspectorCallbacks
  ) {
    this.container.addEventListener('input', (event) => this.handleInput(event));
    this.container.addEventListener('change', (event) => this.handleChange(event));
    this.container.addEventListener('click', (event) => this.handleClick(event));
  }

  public render(state: Readonly<ProjectState>): void {
    this.currentState = state;
    const layer = state.layers.find((item) => item.id === state.selectedLayerId) ?? null;
    const nextStructureKey = [
      // Mask mode decides which routing rows exist, so it belongs in the rebuild key rather
      // than the value sync.
      `${layer?.id ?? ''}:${layer?.groupId ?? ''}:${layer?.kind ?? ''}:${layer?.pattern?.kind ?? ''}:${layer?.maskMode ?? ''}`,
      state.layers.map((item) => `${item.id}:${item.structureSourceLayerId ?? ''}:${item.maskSourceLayerId ?? ''}`).join('|'),
      state.groups.map((item) => `${item.id}:${item.parentId ?? ''}`).join('|'),
      state.importedMeshes.map((item) => item.id).join('|'),
      state.environmentAssetName ?? '',
      surfaceGraphStructureKey(state.surfaceGraph),
      String(state.graphMode)
    ].join('::');

    if (this.currentLayerId !== layer?.id || this.structureKey !== nextStructureKey) {
      this.currentLayerId = layer?.id ?? null;
      this.structureKey = nextStructureKey;
      this.build(layer, state);
      return;
    }
    this.sync(layer, state);
  }

  private build(layer: MaterialLayer | null, state: Readonly<ProjectState>): void {
    const selectedGroup = layer?.groupId === null || layer === null
      ? null
      : state.groups.find((group) => group.id === layer.groupId) ?? null;

    this.container.innerHTML = `
      <div class="panel-header inspector-heading">
        <div>
          <span class="eyebrow">Inspector</span>
          <h2 data-role="inspector-title">${layer === null ? 'Material' : escapeHtml(layer.name)}</h2>
        </div>
        ${layer === null ? '' : `
          <div class="inline-actions">
            <button class="mini-button" data-action="duplicate" aria-label="Duplicate layer" title="Duplicate layer">⧉</button>
            <button class="mini-button danger" data-action="remove" aria-label="Delete layer" title="Delete layer">×</button>
          </div>
        `}
      </div>
      ${layer === null ? '<div class="empty-state">Select a layer to edit procedural routing and parameters.</div>' : this.layerSections(layer, selectedGroup, state)}
      ${this.synthesisSection(state)}
      ${this.physicalSection(state)}
      ${this.viewportSection(state)}
    `;
  }

  private layerSections(layer: MaterialLayer, group: MaterialGroup | null, state: Readonly<ProjectState>): string {
    const maskOptions = state.layers
      .filter((item) => item.id !== layer.id)
      .map((item) => option(item.id, item.name, item.id === layer.maskSourceLayerId))
      .join('');
    const groupOptions = state.groups
      .map((item) => option(item.id, item.name, item.id === layer.groupId))
      .join('');
    const structureOptions = state.layers
      .filter((item) => item.id !== layer.id)
      .map((item) => option(item.id, item.name, item.id === layer.structureSourceLayerId))
      .join('');

    return `
      <section class="inspector-section">
        <label class="field-row field-row-text">
          <span>Name</span>
          <input data-field="name" type="text" maxlength="${MAX_LAYER_NAME_LENGTH}" value="${escapeHtml(layer.name)}">
        </label>
        <div class="field-columns">
          <label class="field-stack">
            <span>Generator</span>
            <select data-field="kind">
              ${LAYER_KINDS.map((item) => option(item.id, item.label, item.id === layer.kind)).join('')}
            </select>
          </label>
          <label class="field-stack">
            <span>Blend</span>
            <select data-field="blendMode">
              ${BLEND_MODES.map((item) => option(item.id, item.label, item.id === layer.blendMode)).join('')}
            </select>
          </label>
        </div>
        <label class="field-stack routing-field">
          <span>Output channel</span>
          <select data-field="channel">
            ${LAYER_CHANNELS.map((item) => option(item.id, item.label, item.id === layer.channel)).join('')}
          </select>
        </label>
        <div class="color-pair">
          <label class="color-field"><input data-field="colorA" type="color" value="${layer.colorA}"><span>Low</span></label>
          <label class="color-field"><input data-field="colorB" type="color" value="${layer.colorB}"><span>High</span></label>
        </div>
      </section>
      <section class="inspector-section parameter-section">
        <div class="section-heading"><span>Layer parameters</span></div>
        ${NUMERIC_FIELDS.map((field) => this.numericRow(field, layer[field.key])).join('')}
      </section>
      ${layer.kind === 'pattern' ? this.patternSection(layer) : ''}
      <details class="inspector-section advanced-section" open>
        <summary>Mask & group routing</summary>
        <label class="field-stack routing-field">
          <span>Shared structure</span>
          <select data-field="structureSourceLayerId">
            ${option('', 'Own generator', layer.structureSourceLayerId === null)}
            ${structureOptions}
          </select>
        </label>
        <label class="field-stack routing-field">
          <span>Mask source</span>
          <select data-field="maskSourceLayerId">
            ${option('', 'None', layer.maskSourceLayerId === null)}
            ${maskOptions}
          </select>
        </label>
        <label class="field-stack routing-field">
          <span>Mask mode</span>
          <select data-field="maskMode">
            ${MASK_MODES.map((item) => option(item.id, item.label, item.id === layer.maskMode)).join('')}
          </select>
        </label>
        ${this.numericRow(
          { key: 'maskStrength', label: 'Mask strength', ...CONTROL_RANGES.layer.maskStrength },
          layer.maskStrength
        )}
        ${layer.maskMode !== 'height' ? '' : `
          ${this.numericRow(
            { key: 'maskThreshold', label: 'Height threshold', ...CONTROL_RANGES.layer.maskThreshold },
            layer.maskThreshold
          )}
          ${this.numericRow(
            { key: 'maskSoftness', label: 'Height softness', ...CONTROL_RANGES.layer.maskSoftness },
            layer.maskSoftness
          )}
          ${this.numericRow(
            { key: 'maskBreakup', label: 'Edge breakup', ...CONTROL_RANGES.layer.maskBreakup },
            layer.maskBreakup
          )}
        `}
        <label class="toggle-row"><span>Invert mask</span><input data-field="maskInvert" type="checkbox" ${layer.maskInvert ? 'checked' : ''}></label>
        <label class="field-stack routing-field">
          <span>Group</span>
          <select data-field="groupId">
            ${option('', 'Ungrouped', layer.groupId === null)}
            ${groupOptions}
          </select>
        </label>
        <button class="compact-button inspector-action" data-action="add-group">＋ New group</button>
        ${group === null ? '' : this.groupEditor(group, state)}
      </details>
    `;
  }

  private patternSection(layer: Readonly<MaterialLayer>): string {
    const pattern = layer.pattern ?? DEFAULT_PATTERN_SETTINGS;
    const vegetation = pattern.kind === 'grass' || pattern.kind === 'turf';
    const baseFields = vegetation ? VEGETATION_BASE_PATTERN_FIELDS : PATTERN_FIELDS;
    const structureFields = pattern.kind === 'grass'
      ? { title: 'Blade structure', fields: GRASS_PATTERN_FIELDS }
      : pattern.kind === 'turf'
        ? { title: 'Turf structure', fields: TURF_PATTERN_FIELDS }
        : null;
    return `
      <details class="inspector-section advanced-section pattern-editor" open>
        <summary>Pattern sampler</summary>
        <label class="field-stack routing-field">
          <span>Pattern type</span>
          <select data-pattern-field="kind">
            ${SURFACE_DESIGNER_CONFIG.patterns.map((item) => option(item.id, item.label, item.id === pattern.kind)).join('')}
          </select>
        </label>
        ${baseFields.map((field) => this.patternRow(field, this.patternValue(pattern, field.key))).join('')}
        ${structureFields === null ? '' : `
          <div class="section-heading pattern-subheading"><span>${structureFields.title}</span></div>
          ${structureFields.fields.map((field) => this.patternRow(field, this.patternValue(pattern, field.key))).join('')}
        `}
      </details>
    `;
  }

  private patternValue(pattern: Readonly<PatternSettings>, key: PatternNumericKey): number {
    const value = pattern[key];
    if (typeof value === 'number') return value;
    const fallback = DEFAULT_PATTERN_SETTINGS[key];
    return typeof fallback === 'number' ? fallback : 0;
  }

  private synthesisSection(state: Readonly<ProjectState>): string {
    const legacyGraph = compileMaterialGraph(state.layers);
    const locks: Array<[keyof GenomeLocks, string]> = [
      ['color', 'Color'], ['structure', 'Structure'], ['roughness', 'Roughness'], ['scale', 'Scale'], ['damage', 'Damage']
    ];
    return `
      <details class="inspector-section advanced-section synthesis-section" open>
        <summary>Material synthesis</summary>
        <div class="synthesis-actions">
          <span class="population-label">Evolution population</span>
          <div class="mutation-population">
            ${['A', 'B', 'C', 'D', 'E', 'F'].map((label, index) => `<button class="compact-button" data-action="mutate" data-variant="${index}">${label}</button>`).join('')}
          </div>
          <label class="toggle-row graph-toggle"><span>Advanced graph</span><input data-synthesis-action="graphMode" type="checkbox" ${state.graphMode ? 'checked' : ''}></label>
        </div>
        <div class="genome-locks" aria-label="Mutation trait locks">
          ${locks.map(([key, label]) => `<label><input data-genome-lock="${key}" type="checkbox" ${state.genomeLocks[key] ? 'checked' : ''}><span>${label}</span></label>`).join('')}
        </div>
        ${SYNTHESIS_FIELDS.map((field) => `
          <div class="parameter-row">
            <span>${field.label}</span>
            <input data-synthesis-field="${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${state.synthesis[field.key]}">
            <input class="number-input" data-synthesis-field="${field.key}" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${state.synthesis[field.key]}">
          </div>
        `).join('')}
        ${state.surfaceGraph === null || state.surfaceGraph === undefined ? '' : this.exposedGraphParameters(state.surfaceGraph)}
        ${state.graphMode
          ? state.surfaceGraph === null || state.surfaceGraph === undefined
            ? `<div class="material-graph" aria-label="Compiled material graph">
                ${legacyGraph.nodes.map((node) => `<div class="graph-node graph-node-${node.kind}"><strong>${escapeHtml(node.label)}</strong><small>${node.kind}</small></div>`).join('')}
                <div class="graph-summary">${legacyGraph.edges.length} routed connections · ${legacyGraph.nodes.length} nodes</div>
              </div>`
            : this.authoredGraph(state.surfaceGraph)
          : ''}
      </details>
    `;
  }

  private exposedGraphParameters(graph: Readonly<SurfaceGraphDefinition>): string {
    if (graph.exposed.length === 0) return '';
    return `
      <div class="graph-exposed-panel">
        <div class="section-heading"><span>Exposed graph parameters</span><small>${escapeHtml(graph.name)}</small></div>
        <div class="graph-exposed-grid">
          ${graph.exposed.map((binding) => this.graphExposedControl(graph, binding)).join('')}
        </div>
      </div>
    `;
  }

  private graphExposedControl(
    graph: Readonly<SurfaceGraphDefinition>,
    binding: Readonly<SurfaceGraphExposedParameter>
  ): string {
    const value = surfaceGraphExposedValue(graph, binding.id);
    if (binding.type === 'boolean') {
      return `<label class="toggle-row graph-exposed-control"><span>${escapeHtml(binding.label)}</span><input data-graph-exposed="${binding.id}" type="checkbox" ${value === true ? 'checked' : ''}></label>`;
    }
    if (binding.type === 'color') {
      return `<label class="field-row compact-field graph-exposed-control"><span>${escapeHtml(binding.label)}</span><input data-graph-exposed="${binding.id}" type="color" value="${escapeHtml(String(value))}"></label>`;
    }
    if (binding.type === 'enum') {
      return `<label class="field-stack graph-exposed-control"><span>${escapeHtml(binding.label)}</span><select data-graph-exposed="${binding.id}">${(binding.options ?? []).map((item) => option(item, item, item === value)).join('')}</select></label>`;
    }
    const min = binding.min ?? 0;
    const max = binding.max ?? 1;
    const step = binding.step ?? 0.01;
    return `
      <div class="parameter-row graph-exposed-control">
        <span>${escapeHtml(binding.label)}</span>
        <input data-graph-exposed="${binding.id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        <input class="number-input" data-graph-exposed="${binding.id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}">
      </div>
    `;
  }

  private authoredGraph(graph: Readonly<SurfaceGraphDefinition>): string {
    const nodes = graph.nodes
      .slice()
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .slice(0, SURFACE_DESIGNER_CONFIG.graph.maxVisibleNodes);
    const edges = graph.edges.slice(0, SURFACE_DESIGNER_CONFIG.graph.maxVisibleEdges);
    return `
      <div class="surface-graph-editor" aria-label="Authored surface graph">
        <div class="surface-graph-header">
          <div><strong>${escapeHtml(graph.name)}</strong><small>Surface Designer graph</small></div>
          <span>${graph.nodes.length} nodes · ${graph.edges.length} edges · ${graph.subgraphs.length} subgraphs</span>
        </div>
        <div class="surface-graph-nodes">
          ${nodes.map((node) => {
            const spec = SURFACE_GRAPH_NODE_SPEC_BY_KIND.get(node.kind);
            return `<article class="surface-graph-node" data-category="${spec?.category ?? 'graph'}">
              <div class="surface-graph-node-heading"><strong>${escapeHtml(node.label)}</strong><span>${escapeHtml(spec?.category ?? 'graph')}</span></div>
              <small>${escapeHtml(node.kind)}${node.runtime === undefined ? '' : ` → ${escapeHtml(node.runtime.kind)}`}</small>
              <div class="surface-graph-ports">
                <span>in · ${escapeHtml(spec?.inputs.map((port) => port.name).join(', ') || '—')}</span>
                <span>out · ${escapeHtml(spec?.outputs.map((port) => port.name).join(', ') || '—')}</span>
              </div>
            </article>`;
          }).join('')}
        </div>
        ${edges.length === 0 ? '' : `<div class="surface-graph-routes">${edges.map((edge) => `<div class="surface-graph-edge"><span>${escapeHtml(edge.from.nodeId)}.${escapeHtml(edge.from.port)}</span><b>→</b><span>${escapeHtml(edge.to.nodeId)}.${escapeHtml(edge.to.port)}</span></div>`).join('')}</div>`}
        ${graph.subgraphs.length === 0 ? '' : `<div class="surface-subgraph-list">${graph.subgraphs.map((subgraph) => `<span>${escapeHtml(subgraph.name)} · ${subgraph.nodes.length} nodes</span>`).join('')}</div>`}
      </div>
    `;
  }

  private groupEditor(group: MaterialGroup, state: Readonly<ProjectState>): string {
    const parentOptions = state.groups
      .filter((item) => item.id !== group.id && canUseGroupAsParent(group.id, item.id, state.groups))
      .map((item) => option(item.id, item.name, item.id === group.parentId))
      .join('');
    const range = CONTROL_RANGES.group.opacity;
    return `
      <div class="group-editor">
        <div class="section-heading"><span>Active group</span><button class="mini-button danger" data-action="remove-group" title="Remove group">×</button></div>
        <label class="field-row field-row-text"><span>Name</span><input data-group-field="name" type="text" maxlength="${MAX_GROUP_NAME_LENGTH}" value="${escapeHtml(group.name)}"></label>
        <label class="toggle-row"><span>Enabled</span><input data-group-field="enabled" type="checkbox" ${group.enabled ? 'checked' : ''}></label>
        <div class="parameter-row">
          <span>Opacity</span>
          <input data-group-field="opacity" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${group.opacity}">
          <input class="number-input" data-group-field="opacity" type="number" min="${range.min}" max="${range.max}" step="${range.step}" value="${group.opacity}">
        </div>
        <label class="field-stack routing-field">
          <span>Parent group</span>
          <select data-group-field="parentId">
            ${option('', 'Root', group.parentId === null)}
            ${parentOptions}
          </select>
        </label>
      </div>
    `;
  }

  private physicalSection(state: Readonly<ProjectState>): string {
    return `
      <details class="inspector-section advanced-section" open>
        <summary>Physical surface</summary>
        <div class="physical-controls">
          ${PHYSICAL_FIELDS.map((field) => this.physicalRow(field, state.physical[field.key])).join('')}
        </div>
        <div class="color-pair physical-color-pair">
          ${this.physicalColor('sheenColor', 'Sheen tint', state.physical.sheenColor)}
          ${this.physicalColor('attenuationColor', 'Absorption', state.physical.attenuationColor)}
        </div>
      </details>
    `;
  }

  private viewportSection(state: Readonly<ProjectState>): string {
    const selectedMesh = state.selectedMeshId === null
      ? null
      : state.importedMeshes.find((mesh) => mesh.id === state.selectedMeshId) ?? null;
    const assigned = selectedMesh === null ? false : state.meshAssignments[selectedMesh.id] ?? true;

    return `
      <details class="inspector-section advanced-section" open>
        <summary>Viewport & target</summary>
        <label class="field-stack routing-field">
          <span>Environment</span>
          <select data-viewport-field="environment">
            ${ENVIRONMENTS.map((item) => option(item.id, item.label, item.id === state.environment)).join('')}
          </select>
        </label>
        <button class="compact-button inspector-action" data-action="load-hdr">Load HDR environment</button>
        ${state.environmentAssetName === null ? '' : `<div class="asset-note">HDR · ${escapeHtml(state.environmentAssetName)}</div>`}
        <label class="field-row compact-field"><span>Background</span><input data-viewport-field="background" type="color" value="${state.background}"></label>
        <label class="toggle-row"><span>Wireframe</span><input data-viewport-field="wireframe" type="checkbox" ${state.wireframe ? 'checked' : ''}></label>
        ${state.importedMeshes.length === 0 ? '' : `
          <div class="mesh-target-editor">
            <label class="field-stack routing-field">
              <span>Imported mesh</span>
              <select data-viewport-field="mesh">
                ${state.importedMeshes.map((mesh) => option(mesh.id, mesh.label, mesh.id === state.selectedMeshId)).join('')}
              </select>
            </label>
            <label class="toggle-row"><span>Apply lab material</span><input data-viewport-field="mesh-assigned" type="checkbox" ${assigned ? 'checked' : ''}></label>
            <div class="asset-note">Click a mesh in the viewport to select it.</div>
          </div>
        `}
      </details>
    `;
  }

  private sync(layer: MaterialLayer | null, state: Readonly<ProjectState>): void {
    const title = this.container.querySelector<HTMLElement>('[data-role="inspector-title"]');
    if (title !== null) title.textContent = layer?.name ?? 'Material';

    if (layer !== null) {
      const fields = this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]');
      for (const field of fields) {
        if (field === document.activeElement) continue;
        const key = field.dataset.field as keyof MaterialLayer | undefined;
        if (key === undefined) continue;
        const value = layer[key];
        if (typeof value === 'boolean' && field instanceof HTMLInputElement) field.checked = value;
        else if (value === null) field.value = '';
        else if (typeof value === 'string' || typeof value === 'number') field.value = String(value);
      }
      const pattern = layer.pattern ?? DEFAULT_PATTERN_SETTINGS;
      for (const field of this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pattern-field]')) {
        if (field === document.activeElement) continue;
        const key = field.dataset.patternField as keyof PatternSettings | undefined;
        if (key === undefined) continue;
        const value = pattern[key] ?? DEFAULT_PATTERN_SETTINGS[key];
        field.value = String(value);
      }

      const group = layer.groupId === null ? null : state.groups.find((item) => item.id === layer.groupId) ?? null;
      if (group !== null) {
        for (const field of this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-group-field]')) {
          if (field === document.activeElement) continue;
          const key = field.dataset.groupField as keyof MaterialGroup | undefined;
          if (key === undefined) continue;
          const value = group[key];
          if (typeof value === 'boolean' && field instanceof HTMLInputElement) field.checked = value;
          else if (value === null) field.value = '';
          else if (typeof value === 'string' || typeof value === 'number') field.value = String(value);
        }
      }
    }

    const layerLabels = new Map(state.layers.map((item) => [item.id, item.name]));
    const groupLabels = new Map(state.groups.map((item) => [item.id, item.name]));
    const meshLabels = new Map(state.importedMeshes.map((item) => [item.id, item.label]));
    syncOptionLabels(this.container.querySelector<HTMLSelectElement>('[data-field="maskSourceLayerId"]'), layerLabels);
    syncOptionLabels(this.container.querySelector<HTMLSelectElement>('[data-field="groupId"]'), groupLabels);
    syncOptionLabels(this.container.querySelector<HTMLSelectElement>('[data-group-field="parentId"]'), groupLabels);
    syncOptionLabels(this.container.querySelector<HTMLSelectElement>('[data-viewport-field="mesh"]'), meshLabels);

    for (const field of this.container.querySelectorAll<HTMLInputElement>('[data-synthesis-field]')) {
      if (field === document.activeElement) continue;
      const key = field.dataset.synthesisField as keyof SynthesisSettings | undefined;
      if (key !== undefined) field.value = String(state.synthesis[key]);
    }
    for (const field of this.container.querySelectorAll<HTMLInputElement>('[data-genome-lock]')) {
      const key = field.dataset.genomeLock as keyof GenomeLocks | undefined;
      if (key !== undefined) field.checked = state.genomeLocks[key];
    }
    const graphMode = this.container.querySelector<HTMLInputElement>('[data-synthesis-action="graphMode"]');
    if (graphMode !== null) graphMode.checked = state.graphMode;

    if (state.surfaceGraph !== null && state.surfaceGraph !== undefined) {
      for (const field of this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-graph-exposed]')) {
        if (field === document.activeElement) continue;
        const id = field.dataset.graphExposed;
        if (id === undefined) continue;
        const value = surfaceGraphExposedValue(state.surfaceGraph, id);
        if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true;
        else field.value = String(value);
      }
    }

    for (const field of this.container.querySelectorAll<HTMLInputElement>('[data-physical-field]')) {
      if (field === document.activeElement) continue;
      const key = field.dataset.physicalField as NumericPhysicalKey | undefined;
      if (key !== undefined) field.value = String(state.physical[key]);
    }
    for (const field of this.container.querySelectorAll<HTMLInputElement>('[data-physical-color]')) {
      if (field === document.activeElement) continue;
      const key = field.dataset.physicalColor as ColorPhysicalKey | undefined;
      if (key !== undefined) field.value = state.physical[key];
    }
    this.syncViewport(state);
  }

  private syncViewport(state: Readonly<ProjectState>): void {
    const environment = this.container.querySelector<HTMLSelectElement>('[data-viewport-field="environment"]');
    if (environment !== null && environment !== document.activeElement) environment.value = state.environment;
    const background = this.container.querySelector<HTMLInputElement>('[data-viewport-field="background"]');
    if (background !== null && background !== document.activeElement) background.value = state.background;
    const wireframe = this.container.querySelector<HTMLInputElement>('[data-viewport-field="wireframe"]');
    if (wireframe !== null) wireframe.checked = state.wireframe;
    const mesh = this.container.querySelector<HTMLSelectElement>('[data-viewport-field="mesh"]');
    if (mesh !== null && mesh !== document.activeElement) mesh.value = state.selectedMeshId ?? '';
    const assigned = this.container.querySelector<HTMLInputElement>('[data-viewport-field="mesh-assigned"]');
    if (assigned !== null && state.selectedMeshId !== null) assigned.checked = state.meshAssignments[state.selectedMeshId] ?? true;
  }

  private numericRow(field: NumericField, value: number): string {
    return `
      <div class="parameter-row">
        <span>${field.label}</span>
        <input data-field="${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
        <input class="number-input" data-field="${field.key}" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
      </div>
    `;
  }

  private patternRow(field: PatternField, value: number): string {
    return `
      <div class="parameter-row">
        <span>${field.label}</span>
        <input data-pattern-field="${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
        <input class="number-input" data-pattern-field="${field.key}" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
      </div>
    `;
  }

  private physicalRow(field: PhysicalField, value: number): string {
    return `
      <div class="parameter-row">
        <span>${field.label}</span>
        <input data-physical-field="${field.key}" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
        <input class="number-input" data-physical-field="${field.key}" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
      </div>
    `;
  }

  private physicalColor(key: ColorPhysicalKey, label: string, value: string): string {
    return `<label class="color-field"><input data-physical-color="${key}" type="color" value="${value}"><span>${label}</span></label>`;
  }

  private readBoundedNumber(target: HTMLInputElement): number | null {
    if (target.value.trim() === '') return null;
    const parsed = Number(target.value);
    if (!Number.isFinite(parsed)) return null;
    const min = target.min === '' ? Number.NEGATIVE_INFINITY : Number(target.min);
    const max = target.max === '' ? Number.POSITIVE_INFINITY : Number(target.max);
    const value = Math.max(min, Math.min(max, parsed));
    target.value = String(value);
    return value;
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

    const graphExposed = target.dataset.graphExposed;
    if (graphExposed !== undefined) {
      if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        this.callbacks.onGraphParameter(graphExposed, target.checked);
      } else if (target instanceof HTMLInputElement && (target.type === 'number' || target.type === 'range')) {
        const value = this.readBoundedNumber(target);
        if (value !== null) {
          this.syncNumberPeers(`[data-graph-exposed="${graphExposed}"]`, target, value);
          if (target.type === 'range') return;
          this.callbacks.onGraphParameter(graphExposed, value);
        }
      } else {
        this.callbacks.onGraphParameter(graphExposed, target.value);
      }
      return;
    }

    const physicalColor = target.dataset.physicalColor as ColorPhysicalKey | undefined;
    if (physicalColor !== undefined) {
      this.callbacks.onPhysical({ [physicalColor]: target.value });
      return;
    }
    const synthesisField = target.dataset.synthesisField as keyof SynthesisSettings | undefined;
    if (synthesisField !== undefined && target instanceof HTMLInputElement) {
      const value = this.readBoundedNumber(target);
      if (value !== null) {
        this.syncNumberPeers(`[data-synthesis-field="${synthesisField}"]`, target, value);
        this.callbacks.onSynthesis({ [synthesisField]: value });
      }
      return;
    }
    const genomeLock = target.dataset.genomeLock as keyof GenomeLocks | undefined;
    if (genomeLock !== undefined && target instanceof HTMLInputElement) {
      this.callbacks.onGenomeLock(genomeLock, target.checked);
      return;
    }
    if (target.dataset.synthesisAction === 'graphMode' && target instanceof HTMLInputElement) {
      this.callbacks.onGraphMode(target.checked);
      return;
    }
    const physicalField = target.dataset.physicalField as NumericPhysicalKey | undefined;
    if (physicalField !== undefined && target instanceof HTMLInputElement) {
      const value = this.readBoundedNumber(target);
      if (value !== null) {
        this.syncNumberPeers(`[data-physical-field="${physicalField}"]`, target, value);
        this.callbacks.onPhysical({ [physicalField]: value });
      }
      return;
    }

    const viewportField = target.dataset.viewportField;
    if (viewportField !== undefined) {
      this.handleViewportInput(viewportField, target);
      return;
    }

    const layerId = this.currentLayerId;
    if (layerId === null) return;

    const patternField = target.dataset.patternField as keyof PatternSettings | undefined;
    if (patternField !== undefined) {
      const layer = this.currentState?.layers.find((item) => item.id === layerId);
      if (layer === undefined) return;
      const pattern = { ...(layer.pattern ?? DEFAULT_PATTERN_SETTINGS) };
      if (patternField === 'kind') {
        pattern.kind = target.value as PatternSettings['kind'];
      } else {
        if (!(target instanceof HTMLInputElement)) return;
        const value = this.readBoundedNumber(target);
        if (value === null) return;
        pattern[patternField] = value;
        this.syncNumberPeers(`[data-pattern-field="${patternField}"]`, target, value);
        if (target.type === 'range') return;
      }
      this.callbacks.onLayerPatch(layerId, { pattern });
      return;
    }

    const groupField = target.dataset.groupField as keyof MaterialGroup | undefined;
    if (groupField !== undefined) {
      const groupId = this.currentState?.layers.find((item) => item.id === layerId)?.groupId ?? null;
      if (groupId === null) return;
      if (groupField === 'enabled' && target instanceof HTMLInputElement) {
        this.callbacks.onGroupPatch(groupId, { enabled: target.checked });
      } else if (groupField === 'opacity' && target instanceof HTMLInputElement) {
        const value = this.readBoundedNumber(target);
        if (value !== null) {
          this.syncNumberPeers('[data-group-field="opacity"]', target, value);
          this.callbacks.onGroupPatch(groupId, { opacity: value });
        }
      } else if (groupField === 'parentId') {
        this.callbacks.onGroupPatch(groupId, { parentId: target.value === '' ? null : target.value });
      } else if (groupField === 'name') {
        this.callbacks.onGroupPatch(groupId, { name: target.value });
      }
      return;
    }

    const field = target.dataset.field as keyof MaterialLayer | undefined;
    if (field === undefined) return;
    if (field === 'maskInvert' && target instanceof HTMLInputElement) {
      this.callbacks.onLayerPatch(layerId, { maskInvert: target.checked });
      return;
    }
    if (field === 'maskMode') {
      this.callbacks.onLayerPatch(layerId, { maskMode: target.value as MaterialLayer['maskMode'] });
      return;
    }
    if (field === 'groupId' || field === 'maskSourceLayerId' || field === 'structureSourceLayerId') {
      this.callbacks.onLayerPatch(layerId, { [field]: target.value === '' ? null : target.value });
      return;
    }
    if (NUMERIC_FIELDS.some((item) => item.key === field) || ROUTING_NUMERIC_KEYS.has(field)) {
      if (!(target instanceof HTMLInputElement)) return;
      const value = this.readBoundedNumber(target);
      if (value === null) return;
      this.syncNumberPeers(`[data-field="${field}"]`, target, value);
      const layer = this.currentState?.layers.find((item) => item.id === layerId);
      if (field === 'seed' && target.type === 'range' && isSimulationLayer(layer)) return;
      this.callbacks.onLayerPatch(layerId, { [field]: value });
      return;
    }
    this.callbacks.onLayerPatch(layerId, { [field]: target.value });
  }

  private handleViewportInput(field: string, target: HTMLInputElement | HTMLSelectElement): void {
    if (field === 'background' && target instanceof HTMLInputElement) this.callbacks.onBackground(target.value);
    else if (field === 'wireframe' && target instanceof HTMLInputElement) this.callbacks.onWireframe(target.checked);
    else if (field === 'environment') this.callbacks.onEnvironment(target.value as EnvironmentPreset);
    else if (field === 'mesh') this.callbacks.onMeshSelect(target.value === '' ? null : target.value);
    else if (field === 'mesh-assigned' && target instanceof HTMLInputElement) {
      const id = this.currentState?.selectedMeshId;
      if (id !== null && id !== undefined) this.callbacks.onMeshAssigned(id, target.checked);
    }
  }

  private handleChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.type === 'range') {
      const value = this.readBoundedNumber(target);
      if (value === null) return;

      const graphExposed = target.dataset.graphExposed;
      if (graphExposed !== undefined) {
        this.syncNumberPeers(`[data-graph-exposed="${graphExposed}"]`, target, value);
        this.callbacks.onGraphParameter(graphExposed, value);
        return;
      }

      const patternField = target.dataset.patternField as PatternNumericKey | undefined;
      if (patternField !== undefined && this.currentLayerId !== null) {
        const state = this.currentState;
        if (state === null) return;
        const layer = state.layers.find((item) => item.id === this.currentLayerId);
        if (layer === undefined) return;
        const pattern = { ...(layer.pattern ?? DEFAULT_PATTERN_SETTINGS), [patternField]: value };
        this.syncNumberPeers(`[data-pattern-field="${patternField}"]`, target, value);
        this.callbacks.onLayerPatch(layer.id, { pattern });
        return;
      }

      const field = target.dataset.field as NumericLayerKey | undefined;
      if (field === 'seed' && this.currentLayerId !== null) {
        const layer = this.currentState?.layers.find((item) => item.id === this.currentLayerId);
        if (isSimulationLayer(layer)) {
          this.syncNumberPeers('[data-field="seed"]', target, value);
          this.callbacks.onLayerPatch(layer.id, { seed: value });
        }
      }
      return;
    }

    if (target.type !== 'number') return;
    if (target.value.trim() !== '' && Number.isFinite(Number(target.value))) return;
    const state = this.currentState;
    if (state === null) return;

    const graphExposed = target.dataset.graphExposed;
    if (graphExposed !== undefined && state.surfaceGraph !== null && state.surfaceGraph !== undefined) {
      const value = surfaceGraphExposedValue(state.surfaceGraph, graphExposed);
      if (typeof value === 'number') this.restoreNumberPeers(`[data-graph-exposed="${graphExposed}"]`, value);
      return;
    }
    const patternField = target.dataset.patternField as PatternNumericKey | undefined;
    if (patternField !== undefined && this.currentLayerId !== null) {
      const layer = state.layers.find((item) => item.id === this.currentLayerId);
      const pattern = layer?.pattern ?? DEFAULT_PATTERN_SETTINGS;
      this.restoreNumberPeers(
        `[data-pattern-field="${patternField}"]`,
        this.patternValue(pattern, patternField)
      );
      return;
    }
    const physicalField = target.dataset.physicalField as NumericPhysicalKey | undefined;
    if (physicalField !== undefined) {
      this.restoreNumberPeers(`[data-physical-field="${physicalField}"]`, state.physical[physicalField]);
      return;
    }
    const synthesisField = target.dataset.synthesisField as keyof SynthesisSettings | undefined;
    if (synthesisField !== undefined) {
      this.restoreNumberPeers(`[data-synthesis-field="${synthesisField}"]`, state.synthesis[synthesisField]);
      return;
    }
    const groupField = target.dataset.groupField;
    if (groupField === 'opacity' && this.currentLayerId !== null) {
      const groupId = state.layers.find((item) => item.id === this.currentLayerId)?.groupId ?? null;
      const group = groupId === null ? null : state.groups.find((item) => item.id === groupId) ?? null;
      if (group !== null) this.restoreNumberPeers('[data-group-field="opacity"]', group.opacity);
      return;
    }
    const field = target.dataset.field as NumericLayerKey | undefined;
    const layer = this.currentLayerId === null ? null : state.layers.find((item) => item.id === this.currentLayerId) ?? null;
    const value = field === undefined || layer === null ? undefined : layer[field];
    if (field !== undefined && typeof value === 'number') this.restoreNumberPeers(`[data-field="${field}"]`, value);
  }

  private syncNumberPeers(selector: string, source: HTMLInputElement, value: number): void {
    const normalized = String(value);
    for (const peer of this.container.querySelectorAll<HTMLInputElement>(selector)) {
      if (peer !== source) peer.value = normalized;
    }
  }

  private restoreNumberPeers(selector: string, value: number): void {
    for (const peer of this.container.querySelectorAll<HTMLInputElement>(selector)) peer.value = String(value);
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    if (target.closest('[data-action="load-hdr"]') !== null) {
      this.callbacks.onEnvironmentImport();
      return;
    }
    if (target.closest('[data-action="mutate"]') !== null) {
      const button = target.closest<HTMLElement>('[data-action="mutate"]');
      this.callbacks.onMutate(Number(button?.dataset.variant ?? 0));
      return;
    }

    const layerId = this.currentLayerId;
    if (layerId === null) return;
    if (target.closest('[data-action="duplicate"]') !== null) this.callbacks.onDuplicate(layerId);
    else if (target.closest('[data-action="remove"]') !== null) this.callbacks.onRemove(layerId);
    else if (target.closest('[data-action="add-group"]') !== null) this.callbacks.onGroupAdd(layerId);
    else if (target.closest('[data-action="remove-group"]') !== null) {
      const groupId = this.currentState?.layers.find((item) => item.id === layerId)?.groupId ?? null;
      if (groupId !== null) this.callbacks.onGroupRemove(groupId);
    }
  }
}
