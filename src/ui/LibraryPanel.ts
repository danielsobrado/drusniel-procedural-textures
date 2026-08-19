import { OBJECT_PRESETS } from '../app/constants';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset, ObjectPreset, ProjectState } from '../materials/types';
import { escapeHtml } from '../utils/html';

export interface LibraryCallbacks {
  onObject: (preset: ObjectPreset) => void;
  onPreset: (preset: MaterialPreset) => void;
  onImport: () => void;
}

const PRESET_TAGS = [...new Set(MATERIAL_PRESETS.flatMap((preset) => preset.tags))]
  .sort((left, right) => left.localeCompare(right));

export class LibraryPanel {
  private filter = '';
  private activeTag = 'all';
  private readonly thumbnails = new Map<string, string>();

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
        <button class="mini-button" data-action="import" aria-label="Import GLB or GLTF" title="Import GLB / GLTF">＋</button>
      </div>

      <label class="search-field">
        <span aria-hidden="true">⌕</span>
        <input data-action="filter" type="search" value="${escapeHtml(this.filter)}" placeholder="Search presets or tags" aria-label="Filter material presets">
      </label>

      <section class="library-section">
        <div class="section-heading">
          <span>Preview object</span>
          ${state.importedAssetName === null ? '' : `<span class="asset-chip">${escapeHtml(state.importedAssetName)}</span>`}
        </div>
        <div class="object-grid">
          ${OBJECT_PRESETS.map((item) => `
            <button
              class="object-tile ${state.importedAssetName === null && state.selectedObject === item.id ? 'is-active' : ''}"
              data-object="${item.id}"
              title="${escapeHtml(item.label)}"
              aria-label="Preview ${escapeHtml(item.label)}"
            >
              <span class="object-glyph" aria-hidden="true">${escapeHtml(item.glyph)}</span>
              <span>${escapeHtml(item.label)}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="library-section preset-section">
        <div class="section-heading">
          <span>Material presets</span>
          <span data-role="preset-count">${MATERIAL_PRESETS.length}</span>
        </div>
        <div class="preset-tags" role="group" aria-label="Filter presets by tag">
          <button class="tag-chip ${this.activeTag === 'all' ? 'is-active' : ''}" data-tag="all">All</button>
          ${PRESET_TAGS.map((tag) => `
            <button class="tag-chip ${this.activeTag === tag ? 'is-active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>
          `).join('')}
        </div>
        <div class="preset-list">
          ${MATERIAL_PRESETS.map((preset) => this.presetCard(preset)).join('')}
          <div class="empty-state" data-role="filter-empty" hidden>No matching presets.</div>
        </div>
      </section>
    `;

    this.applyFilter();
  }

  public setThumbnails(thumbnails: ReadonlyMap<string, string>): void {
    this.thumbnails.clear();
    for (const [id, url] of thumbnails) this.thumbnails.set(id, url);

    const cards = this.container.querySelectorAll<HTMLElement>('[data-preset]');
    for (const card of cards) {
      const id = card.dataset.preset;
      if (id === undefined) continue;
      const thumbnail = this.thumbnails.get(id);
      const host = card.querySelector<HTMLElement>('[data-role="preset-thumb"]');
      if (thumbnail === undefined || host === null) continue;
      host.innerHTML = `<img src="${escapeHtml(thumbnail)}" alt="" aria-hidden="true">`;
      host.classList.add('has-thumbnail');
    }
  }

  private presetCard(preset: MaterialPreset): string {
    const thumbnail = this.thumbnails.get(preset.id);
    const thumbnailContent = thumbnail === undefined
      ? ''
      : `<img src="${escapeHtml(thumbnail)}" alt="" aria-hidden="true">`;
    const tags = preset.tags.join(' ');
    return `
      <button
        class="preset-card"
        data-preset="${escapeHtml(preset.id)}"
        data-tags="${escapeHtml(tags)}"
        data-search="${escapeHtml(`${preset.name} ${preset.description} ${tags}`.toLowerCase())}"
      >
        <span
          class="preset-swatch ${thumbnail === undefined ? '' : 'has-thumbnail'}"
          data-role="preset-thumb"
          aria-hidden="true"
          style="--swatch-a:${preset.layers[0]?.colorA ?? '#333'};--swatch-b:${preset.layers.at(-1)?.colorB ?? '#aaa'}"
        >${thumbnailContent}</span>
        <span class="preset-copy">
          <strong>${escapeHtml(preset.name)}</strong>
          <small>${escapeHtml(preset.description)}</small>
          <span class="preset-card-tags">${preset.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</span>
        </span>
        <span class="preset-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;

    const tagButton = target.closest<HTMLElement>('[data-tag]');
    if (tagButton?.dataset.tag !== undefined) {
      this.activeTag = tagButton.dataset.tag;
      this.applyFilter();
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
      if (preset !== undefined) this.callbacks.onPreset(preset);
      return;
    }

    if (target.closest('[data-action="import"]') !== null) {
      this.callbacks.onImport();
    }
  }

  private handleInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.action !== 'filter') return;

    this.filter = input.value;
    this.applyFilter();
  }

  private applyFilter(): void {
    const query = this.filter.trim().toLowerCase();
    const cards = this.container.querySelectorAll<HTMLElement>('[data-preset][data-search][data-tags]');
    let visibleCount = 0;

    for (const card of cards) {
      const matchesSearch = query.length === 0 || (card.dataset.search ?? '').includes(query);
      const tags = (card.dataset.tags ?? '').split(/\s+/u);
      const matchesTag = this.activeTag === 'all' || tags.includes(this.activeTag);
      const visible = matchesSearch && matchesTag;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    const tagButtons = this.container.querySelectorAll<HTMLElement>('[data-tag]');
    for (const tagButton of tagButtons) {
      tagButton.classList.toggle('is-active', tagButton.dataset.tag === this.activeTag);
    }

    const count = this.container.querySelector<HTMLElement>('[data-role="preset-count"]');
    if (count !== null) count.textContent = String(visibleCount);

    const empty = this.container.querySelector<HTMLElement>('[data-role="filter-empty"]');
    if (empty !== null) empty.hidden = visibleCount !== 0;
  }
}
