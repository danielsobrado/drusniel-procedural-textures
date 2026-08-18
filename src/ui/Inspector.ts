import { BLEND_MODES, LAYER_KINDS } from '../app/constants';
import type { MaterialLayer, ProjectState } from '../materials/types';

export interface InspectorCallbacks {
  onLayerPatch: (id: string, patch: Partial<MaterialLayer>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onBackground: (color: string) => void;
  onWireframe: (enabled: boolean) => void;
}

interface NumericField {
  key: keyof Pick<MaterialLayer, 'opacity' | 'scale' | 'strength' | 'seed' | 'roughness' | 'displacement'>;
  label: string;
  min: number;
  max: number;
  step: number;
}

const NUMERIC_FIELDS: readonly NumericField[] = [
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { key: 'scale', label: 'Scale', min: 0.1, max: 20, step: 0.1 },
  { key: 'strength', label: 'Strength', min: 0, max: 2.5, step: 0.01 },
  { key: 'seed', label: 'Seed', min: 0, max: 100, step: 1 },
  { key: 'roughness', label: 'Roughness Δ', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'displacement', label: 'Displace', min: -0.18, max: 0.18, step: 0.001 }
];

export class Inspector {
  private currentLayerId: string | null = null;

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: InspectorCallbacks
  ) {
    this.container.addEventListener('input', (event) => this.handleInput(event));
    this.container.addEventListener('change', (event) => this.handleInput(event));
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
          <h2>${this.escape(layer.name)}</h2>
        </div>
        <div class="inline-actions">
          <button class="mini-button" data-action="duplicate" title="Duplicate layer">⧉</button>
          <button class="mini-button danger" data-action="remove" title="Delete layer">×</button>
        </div>
      </div>

      <section class="inspector-section">
        <label class="field-row field-row-text">
          <span>Name</span>
          <input data-field="name" type="text" value="${this.escape(layer.name)}">
        </label>

        <div class="field-columns">
          <label class="field-stack">
            <span>Generator</span>
            <select data-field="kind">
              ${LAYER_KINDS.map((item) => `<option value="${item.id}" ${item.id === layer.kind ? 'selected' : ''}>${item.label}</option>`).join('')}
            </select>
          </label>
          <label class="field-stack">
            <span>Blend</span>
            <select data-field="blendMode">
              ${BLEND_MODES.map((item) => `<option value="${item.id}" ${item.id === layer.blendMode ? 'selected' : ''}>${item.label}</option>`).join('')}
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

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const layerId = this.currentLayerId;
    if (layerId === null) {
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

    const field = target.dataset.field as keyof MaterialLayer | undefined;
    if (field === undefined) {
      return;
    }

    if (target.dataset.peer !== undefined) {
      const peers = this.container.querySelectorAll<HTMLInputElement>(`[data-field="${field}"]`);
      for (const peer of peers) {
        if (peer !== target) {
          peer.value = target.value;
        }
      }
    }

    if (
      field === 'opacity' ||
      field === 'scale' ||
      field === 'strength' ||
      field === 'seed' ||
      field === 'roughness' ||
      field === 'displacement'
    ) {
      const value = Number(target.value);
      if (Number.isFinite(value)) {
        this.callbacks.onLayerPatch(layerId, { [field]: value });
      }
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

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }
}
