import { OBJECT_PRESETS } from '../app/constants';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset, ObjectPreset, ProjectState } from '../materials/types';

export interface LibraryCallbacks {
  onObject: (preset: ObjectPreset) => void;
  onPreset: (preset: MaterialPreset) => void;
  onImport: () => void;
}

export class LibraryPanel {
  private filter = '';

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: LibraryCallbacks
  ) {
    this.container.addEventListener('click', (event) => this.handleClick(event));
    this.container.addEventListener('input', (event) => this.handleInput(event));
  }

  public render(state: Readonly<ProjectState>): void {
    this.container.innerHTML = `
      <div class="panel-header">
        <div>
          <span class="eyebrow">Library</span>
          <h2>Objects & materials</h2>
        </div>
        <button class="mini-button" data-action="import" title="Import GLB / GLTF">＋</button>
      </div>

      <label class="search-field">
        <span>⌕</span>
        <input data-action="filter" type="search" value="${this.escape(this.filter)}" placeholder="Filter presets">
      </label>

      <section class="library-section">
        <div class="section-heading">
          <span>Preview object</span>
          ${state.importedAssetName === null ? '' : `<span class="asset-chip">${this.escape(state.importedAssetName)}</span>`}
        </div>
        <div class="object-grid">
          ${OBJECT_PRESETS.map((item) => `
            <button
              class="object-tile ${state.importedAssetName === null && state.selectedObject === item.id ? 'is-active' : ''}"
              data-object="${item.id}"
              title="${item.label}"
            >
              <span class="object-glyph">${item.glyph}</span>
              <span>${item.label}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="library-section preset-section">
        <div class="section-heading">
          <span>Material presets</span>
          <span data-role="preset-count">${MATERIAL_PRESETS.length}</span>
        </div>
        <div class="preset-list">
          ${MATERIAL_PRESETS.map((preset) => `
            <button
              class="preset-card"
              data-preset="${preset.id}"
              data-search="${this.escape(`${preset.name} ${preset.description}`.toLowerCase())}"
            >
              <span class="preset-swatch" style="--swatch-a:${preset.layers[0]?.colorA ?? '#333'};--swatch-b:${preset.layers.at(-1)?.colorB ?? '#aaa'}"></span>
              <span class="preset-copy">
                <strong>${this.escape(preset.name)}</strong>
                <small>${this.escape(preset.description)}</small>
              </span>
              <span class="preset-arrow">›</span>
            </button>
          `).join('')}
          <div class="empty-state" data-role="filter-empty" hidden>No matching presets.</div>
        </div>
      </section>
    `;

    this.applyFilter();
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) {
      return;
    }

    const objectButton = target.closest<HTMLElement>('[data-object]');
    if (objectButton?.dataset.object !== undefined) {
      this.callbacks.onObject(objectButton.dataset.object as ObjectPreset);
      return;
    }

    const presetButton = target.closest<HTMLElement>('[data-preset]');
    if (presetButton?.dataset.preset !== undefined) {
      const preset = MATERIAL_PRESETS.find((item) => item.id === presetButton.dataset.preset);
      if (preset !== undefined) {
        this.callbacks.onPreset(preset);
      }
      return;
    }

    if (target.closest('[data-action="import"]') !== null) {
      this.callbacks.onImport();
    }
  }

  private handleInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.action !== 'filter') {
      return;
    }

    this.filter = input.value;
    this.applyFilter();
  }

  private applyFilter(): void {
    const query = this.filter.trim().toLowerCase();
    const cards = this.container.querySelectorAll<HTMLElement>('[data-preset][data-search]');
    let visibleCount = 0;

    for (const card of cards) {
      const visible = query.length === 0 || (card.dataset.search ?? '').includes(query);
      card.hidden = !visible;
      if (visible) {
        visibleCount += 1;
      }
    }

    const count = this.container.querySelector<HTMLElement>('[data-role="preset-count"]');
    if (count !== null) {
      count.textContent = String(visibleCount);
    }

    const empty = this.container.querySelector<HTMLElement>('[data-role="filter-empty"]');
    if (empty !== null) {
      empty.hidden = visibleCount !== 0;
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
