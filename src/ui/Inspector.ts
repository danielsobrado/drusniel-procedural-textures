import {
  BLEND_MODES,
  CONTROL_RANGES,
  ENVIRONMENTS,
  LAYER_CHANNELS,
  LAYER_KINDS
} from '../app/constants';
import { MAX_GROUP_NAME_LENGTH, MAX_LAYER_NAME_LENGTH } from '../app/ProjectFile';
import type {
  EnvironmentPreset,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  ProjectState
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
  onEnvironment: (environment: EnvironmentPreset) => void;
  onEnvironmentImport: () => void;
  onMeshSelect: (id: string | null) => void;
  onMeshAssigned: (id: string, assigned: boolean) => void;
}

type NumericLayerKey = keyof Pick<
  MaterialLayer,
  'opacity' | 'scale' | 'strength' | 'seed' | 'roughness' | 'displacement' | 'maskStrength'
>;

interface NumericField {
  key: NumericLayerKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

type NumericPhysicalKey = Exclude<keyof PhysicalSettings, 'sheenColor' | 'attenuationColor'>;
type ColorPhysicalKey = Extract<keyof PhysicalSettings, 'sheenColor' | 'attenuationColor'>;

interface PhysicalField {
  key: NumericPhysicalKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const NUMERIC_FIELDS: readonly NumericField[] = [
  { key: 'opacity', label: 'Opacity', ...CONTROL_RANGES.layer.opacity },
  { key: 'scale', label: 'Scale', ...CONTROL_RANGES.layer.scale },
  { key: 'strength', label: 'Strength', ...CONTROL_RANGES.layer.strength },
  { key: 'seed', label: 'Seed', ...CONTROL_RANGES.layer.seed },
  { key: 'roughness', label: 'Roughness Δ', ...CONTROL_RANGES.layer.roughness },
  { key: 'displacement', label: 'Displace', ...CONTROL_RANGES.layer.displacement }
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

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
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
      state.layers.map((item) => `${item.id}:${item.name}`).join('|'),
      state.groups.map((item) => `${item.id}:${item.name}`).join('|'),
      state.importedMeshes.map((item) => `${item.id}:${item.label}`).join('|')
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
      ${this.physicalSection(state)}
      ${this.viewportSection(state)}
    `;
  }

  private layerSections(
    layer: MaterialLayer,
    group: MaterialGroup | null,
    state: Readonly<ProjectState>
  ): string {
    const maskOptions = state.layers
      .filter((item) => item.id !== layer.id)
      .map((item) => option(item.id, item.name, item.id === layer.maskSourceLayerId))
      .join('');
    const groupOptions = state.groups
      .map((item) => option(item.id, item.name, item.id === layer.groupId))
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

      <details class="inspector-section advanced-section" open>
        <summary>Mask & group routing</summary>
        <label class="field-stack routing-field">
          <span>Mask source</span>
          <select data-field="maskSourceLayerId">
            ${option('', 'None', layer.maskSourceLayerId === null)}
            ${maskOptions}
          </select>
        </label>
        ${this.numericRow(
          { key: 'maskStrength', label: 'Mask strength', ...CONTROL_RANGES.layer.maskStrength },
          layer.maskStrength
        )}
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

  private groupEditor(group: MaterialGroup, state: Readonly<ProjectState>): string {
    const parentOptions = state.groups
      .filter((item) => item.id !== group.id)
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
          <input data-group-field="opacity" data-group-peer="range" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${group.opacity}">
          <input class="number-input" data-group-field="opacity" data-group-peer="number" type="number" min="${range.min}" max="${range.max}" step="${range.step}" value="${group.opacity}">
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
    if (title !== null) {
      title.textContent = layer?.name ?? 'Material';
    }

    if (layer !== null) {
      const fields = this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]');
      for (const field of fields) {
        if (field === document.activeElement) continue;
        const key = field.dataset.field as keyof MaterialLayer | undefined;
        if (key === undefined) continue;
        const value = layer[key];
        if (typeof value === 'boolean' && field instanceof HTMLInputElement) {
          field.checked = value;
        } else if (value === null) {
          field.value = '';
        } else if (typeof value === 'string' || typeof value === 'number') {
          field.value = String(value);
        }
      }

      const group = layer.groupId === null ? null : state.groups.find((item) => item.id === layer.groupId) ?? null;
      if (group !== null) {
        const groupFields = this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-group-field]');
        for (const field of groupFields) {
          if (field === document.activeElement) continue;
          const key = field.dataset.groupField as keyof MaterialGroup | undefined;
          if (key === undefined) continue;
          const value = group[key];
          if (typeof value === 'boolean' && field instanceof HTMLInputElement) {
            field.checked = value;
          } else if (value === null) {
            field.value = '';
          } else if (typeof value === 'string' || typeof value === 'number') {
            field.value = String(value);
          }
        }
      }
    }

    const physicalFields = this.container.querySelectorAll<HTMLInputElement>('[data-physical-field]');
    for (const field of physicalFields) {
      if (field === document.activeElement) continue;
      const key = field.dataset.physicalField as NumericPhysicalKey | undefined;
      if (key !== undefined) field.value = String(state.physical[key]);
    }
    const physicalColors = this.container.querySelectorAll<HTMLInputElement>('[data-physical-color]');
    for (const field of physicalColors) {
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
    if (assigned !== null && state.selectedMeshId !== null) {
      assigned.checked = state.meshAssignments[state.selectedMeshId] ?? true;
    }
  }

  private numericRow(field: NumericField, value: number): string {
    return `
      <div class="parameter-row">
        <span>${field.label}</span>
        <input data-field="${field.key}" data-peer="range" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
        <input class="number-input" data-field="${field.key}" data-peer="number" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
      </div>
    `;
  }

  private physicalRow(field: PhysicalField, value: number): string {
    return `
      <div class="parameter-row">
        <span>${field.label}</span>
        <input data-physical-field="${field.key}" data-physical-peer="range" type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
        <input class="number-input" data-physical-field="${field.key}" data-physical-peer="number" type="number" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
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

    const physicalColor = target.dataset.physicalColor as ColorPhysicalKey | undefined;
    if (physicalColor !== undefined) {
      this.callbacks.onPhysical({ [physicalColor]: target.value });
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
    if (field === 'groupId' || field === 'maskSourceLayerId') {
      this.callbacks.onLayerPatch(layerId, { [field]: target.value === '' ? null : target.value });
      return;
    }
    if (NUMERIC_FIELDS.some((item) => item.key === field) || field === 'maskStrength') {
      if (!(target instanceof HTMLInputElement)) return;
      const value = this.readBoundedNumber(target);
      if (value === null) return;
      this.syncNumberPeers(`[data-field="${field}"]`, target, value);
      this.callbacks.onLayerPatch(layerId, { [field]: value });
      return;
    }
    this.callbacks.onLayerPatch(layerId, { [field]: target.value });
  }

  private handleViewportInput(
    field: string,
    target: HTMLInputElement | HTMLSelectElement
  ): void {
    if (field === 'background' && target instanceof HTMLInputElement) {
      this.callbacks.onBackground(target.value);
    } else if (field === 'wireframe' && target instanceof HTMLInputElement) {
      this.callbacks.onWireframe(target.checked);
    } else if (field === 'environment') {
      this.callbacks.onEnvironment(target.value as EnvironmentPreset);
    } else if (field === 'mesh') {
      this.callbacks.onMeshSelect(target.value === '' ? null : target.value);
    } else if (field === 'mesh-assigned' && target instanceof HTMLInputElement) {
      const id = this.currentState?.selectedMeshId;
      if (id !== null && id !== undefined) {
        this.callbacks.onMeshAssigned(id, target.checked);
      }
    }
  }

  private handleChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'number') return;
    if (target.value.trim() !== '' && Number.isFinite(Number(target.value))) return;
    const state = this.currentState;
    if (state === null) return;

    const physicalField = target.dataset.physicalField as NumericPhysicalKey | undefined;
    if (physicalField !== undefined) {
      this.restoreNumberPeers(`[data-physical-field="${physicalField}"]`, state.physical[physicalField]);
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
    if (field !== undefined && layer !== null && typeof layer[field] === 'number') {
      this.restoreNumberPeers(`[data-field="${field}"]`, layer[field]);
    }
  }

  private syncNumberPeers(selector: string, source: HTMLInputElement, value: number): void {
    const normalized = String(value);
    for (const peer of this.container.querySelectorAll<HTMLInputElement>(selector)) {
      if (peer !== source) peer.value = normalized;
    }
  }

  private restoreNumberPeers(selector: string, value: number): void {
    for (const peer of this.container.querySelectorAll<HTMLInputElement>(selector)) {
      peer.value = String(value);
    }
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;

    if (target.closest('[data-action="load-hdr"]') !== null) {
      this.callbacks.onEnvironmentImport();
      return;
    }

    const layerId = this.currentLayerId;
    if (layerId === null) return;
    if (target.closest('[data-action="duplicate"]') !== null) {
      this.callbacks.onDuplicate(layerId);
    } else if (target.closest('[data-action="remove"]') !== null) {
      this.callbacks.onRemove(layerId);
    } else if (target.closest('[data-action="add-group"]') !== null) {
      this.callbacks.onGroupAdd(layerId);
    } else if (target.closest('[data-action="remove-group"]') !== null) {
      const groupId = this.currentState?.layers.find((item) => item.id === layerId)?.groupId ?? null;
      if (groupId !== null) this.callbacks.onGroupRemove(groupId);
    }
  }
}
