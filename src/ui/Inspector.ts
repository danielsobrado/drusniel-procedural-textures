import { BLEND_MODES, CONTROL_RANGES, LAYER_KINDS } from '../app/constants';
import type { MaterialLayer, PhysicalSettings, ProjectState } from '../materials/types';
import { escapeHtml } from '../utils/html';

export interface InspectorCallbacks {
  onLayerPatch: (id: string, patch: Partial<MaterialLayer>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onBackground: (color: string) => void;
  onWireframe: (enabled: boolean) => void;
  onPhysical: (patch: Partial<PhysicalSettings>) => void;
}

interface NumericField {
  key: keyof Pick<MaterialLayer, 'opacity' | 'scale' | 'strength' | 'seed' | 'roughness' | 'displacement'>;
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

const MAX_LAYER_NAME_LENGTH = 120;

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
  {
    key: 'clearcoatRoughness',
    label: 'Coat roughness',
    ...CONTROL_RANGES.physical.clearcoatRoughness
  },
  {
    key: 'specularIntensity',
    label: 'Specular',
    ...CONTROL_RANGES.physical.specularIntensity
  },
  { key: 'ior', label: 'IOR', ...CONTROL_RANGES.physical.ior },
  { key: 'sheen', label: 'Sheen', ...CONTROL_RANGES.physical.sheen },
  {
    key: 'sheenRoughness',
    label: 'Sheen roughness',
    ...CONTROL_RANGES.physical.sheenRoughness
  },
  {
    key: 'transmission',
    label: 'Transmission',
    ...CONTROL_RANGES.physical.transmission
  },
  { key: 'thickness', label: 'Thickness', ...CONTROL_RANGES.physical.thickness },
  {
    key: 'attenuationDistance',
    label: 'Absorb distance',
    ...CONTROL_RANGES.physical.attenuationDistance
  }
];

export class Inspector {
  private currentLayerId: string | null = null;

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: InspectorCallbacks
  ) {
    this.container.addEventListener('input', (event) => this.handleInput(event));
    this.container.addEventListener('click', (event) => this.handleClick(event));
  }

  public render(state: Readonly<ProjectState>): void {
    const layer = state.layers.find((item) => item.id === state.selectedLayerId) ?? null;

    if (layer === null) {
      this.currentLayerId = null;
      this.container.innerHTML = `
        <div class="panel-header">
          <div><span class="eyebrow">Inspector</span><h2>No layer selected</h2></div>
        </div>
        <div class="empty-state">Select a material layer to edit its procedural parameters.</div>
      `;
      return;
    }

    if (this.currentLayerId !== layer.id) {
      this.currentLayerId = layer.id;
      this.build(layer, state);
      return;
    }

    this.sync(layer, state);
  }

  private build(layer: MaterialLayer, state: Readonly<ProjectState>): void {
    this.container.innerHTML = `
      <div class="panel-header inspector-heading">
        <div>
          <span class="eyebrow">Inspector</span>
          <h2 data-role="inspector-title">${escapeHtml(layer.name)}</h2>
        </div>
        <div class="inline-actions">
          <button class="mini-button" data-action="duplicate" aria-label="Duplicate layer" title="Duplicate layer">⧉</button>
          <button class="mini-button danger" data-action="remove" aria-label="Delete layer" title="Delete layer">×</button>
        </div>
      </div>

      <section class="inspector-section">
        <label class="field-row field-row-text">
          <span>Name</span>
          <input data-field="name" type="text" maxlength="${MAX_LAYER_NAME_LENGTH}" value="${escapeHtml(layer.name)}">
        </label>

        <div class="field-columns">
          <label class="field-stack">
            <span>Generator</span>
            <select data-field="kind">
              ${LAYER_KINDS.map((item) => `<option value="${item.id}" ${item.id === layer.kind ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field-stack">
            <span>Blend</span>
            <select data-field="blendMode">
              ${BLEND_MODES.map((item) => `<option value="${item.id}" ${item.id === layer.blendMode ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="color-pair">
          <label class="color-field">
            <input data-field="colorA" type="color" value="${layer.colorA}">
            <span>Low</span>
          </label>
          <label class="color-field">
            <input data-field="colorB" type="color" value="${layer.colorB}">
            <span>High</span>
          </label>
        </div>
      </section>

      <section class="inspector-section parameter-section">
        <div class="section-heading"><span>Layer parameters</span></div>
        ${NUMERIC_FIELDS.map((field) => this.numericRow(field, layer[field.key])).join('')}
      </section>

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

      <details class="inspector-section advanced-section" open>
        <summary>Viewport</summary>
        <label class="field-row compact-field">
          <span>Background</span>
          <input data-viewport-field="background" type="color" value="${state.background}">
        </label>
        <label class="toggle-row">
          <span>Wireframe</span>
          <input data-viewport-field="wireframe" type="checkbox" ${state.wireframe ? 'checked' : ''}>
        </label>
      </details>
    `;
  }

  private sync(layer: MaterialLayer, state: Readonly<ProjectState>): void {
    const title = this.container.querySelector<HTMLElement>('[data-role="inspector-title"]');
    if (title !== null) {
      title.textContent = layer.name;
    }

    const fields = this.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]');
    for (const field of fields) {
      if (field === document.activeElement) {
        continue;
      }

      const key = field.dataset.field as keyof MaterialLayer | undefined;
      if (key === undefined) {
        continue;
      }

      const value = layer[key];
      if (typeof value === 'boolean' && field instanceof HTMLInputElement) {
        field.checked = value;
      } else if (typeof value === 'string' || typeof value === 'number') {
        field.value = String(value);
      }
    }

    const physicalFields = this.container.querySelectorAll<HTMLInputElement>('[data-physical-field]');
    for (const field of physicalFields) {
      if (field === document.activeElement) {
        continue;
      }
      const key = field.dataset.physicalField as NumericPhysicalKey | undefined;
      if (key !== undefined) {
        field.value = String(state.physical[key]);
      }
    }

    const physicalColors = this.container.querySelectorAll<HTMLInputElement>('[data-physical-color]');
    for (const field of physicalColors) {
      if (field === document.activeElement) {
        continue;
      }
      const key = field.dataset.physicalColor as ColorPhysicalKey | undefined;
      if (key !== undefined) {
        field.value = state.physical[key];
      }
    }

    const background = this.container.querySelector<HTMLInputElement>('[data-viewport-field="background"]');
    if (background !== null && background !== document.activeElement) {
      background.value = state.background;
    }

    const wireframe = this.container.querySelector<HTMLInputElement>('[data-viewport-field="wireframe"]');
    if (wireframe !== null) {
      wireframe.checked = state.wireframe;
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
    return `
      <label class="color-field">
        <input data-physical-color="${key}" type="color" value="${value}">
        <span>${label}</span>
      </label>
    `;
  }

  private readBoundedNumber(target: HTMLInputElement): number | null {
    if (target.value.trim() === '') {
      return null;
    }

    const parsed = Number(target.value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    const min = target.min === '' ? Number.NEGATIVE_INFINITY : Number(target.min);
    const max = target.max === '' ? Number.POSITIVE_INFINITY : Number(target.max);
    const value = Math.max(min, Math.min(max, parsed));
    target.value = String(value);
    return value;
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const physicalColor = target.dataset.physicalColor as ColorPhysicalKey | undefined;
    if (physicalColor !== undefined) {
      this.callbacks.onPhysical({ [physicalColor]: target.value });
      return;
    }

    const physicalField = target.dataset.physicalField as NumericPhysicalKey | undefined;
    if (physicalField !== undefined && target instanceof HTMLInputElement) {
      const value = this.readBoundedNumber(target);
      if (value !== null) {
        const peers = this.container.querySelectorAll<HTMLInputElement>(`[data-physical-field="${physicalField}"]`);
        for (const peer of peers) {
          if (peer !== target) {
            peer.value = target.value;
          }
        }
        this.callbacks.onPhysical({ [physicalField]: value });
      }
      return;
    }

    const viewportField = target.dataset.viewportField;
    if (viewportField === 'background' && target instanceof HTMLInputElement) {
      this.callbacks.onBackground(target.value);
      return;
    }

    if (viewportField === 'wireframe' && target instanceof HTMLInputElement) {
      this.callbacks.onWireframe(target.checked);
      return;
    }

    const layerId = this.currentLayerId;
    if (layerId === null) {
      return;
    }

    const field = target.dataset.field as keyof MaterialLayer | undefined;
    if (field === undefined) {
      return;
    }

    if (
      field === 'opacity' ||
      field === 'scale' ||
      field === 'strength' ||
      field === 'seed' ||
      field === 'roughness' ||
      field === 'displacement'
    ) {
      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      const value = this.readBoundedNumber(target);
      if (value === null) {
        return;
      }

      const peers = this.container.querySelectorAll<HTMLInputElement>(`[data-field="${field}"]`);
      for (const peer of peers) {
        if (peer !== target) {
          peer.value = target.value;
        }
      }

      this.callbacks.onLayerPatch(layerId, { [field]: value });
      return;
    }

    this.callbacks.onLayerPatch(layerId, { [field]: target.value });
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || this.currentLayerId === null) {
      return;
    }

    if (target.closest('[data-action="duplicate"]') !== null) {
      this.callbacks.onDuplicate(this.currentLayerId);
      return;
    }

    if (target.closest('[data-action="remove"]') !== null) {
      this.callbacks.onRemove(this.currentLayerId);
    }
  }
}
