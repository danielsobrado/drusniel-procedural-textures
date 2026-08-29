import { MAX_PROJECT_FILE_BYTES, OBJECT_PRESETS } from '../app/constants';
import { presetThumbnailUrl } from '../assets/PresetAssets';
import {
  parseMaterialPresetFile,
  serializeMaterialPresetFile
} from '../app/MaterialPresetFile';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset, ObjectPreset, ProjectState } from '../materials/types';
import { downloadText } from '../utils/download';
import { escapeHtml } from '../utils/html';

export interface LibraryCallbacks {
  onObject: (preset: ObjectPreset) => void;
  onPreset: (preset: MaterialPreset) => void;
  onImport: () => void;
  getProjectState: () => Readonly<ProjectState>;
}

const PRESET_TAGS = [...new Set(MATERIAL_PRESETS.flatMap((preset) => preset.tags))]
  .sort((left, right) => left.localeCompare(right));
const PRESET_FILE_SUFFIX = '.ptlpreset.json';
const BYTES_PER_MIB = 1024 * 1024;
const FALLBACK_SWATCH_A = '#33383f';
const FALLBACK_SWATCH_B = '#a4adb8';

function presetFileStem(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return stem.length > 0 ? stem : 'material-preset';
}

export class LibraryPanel {
  private filter = '';
  private activeTag = 'all';
  private built = false;

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: LibraryCallbacks
  ) {
    this.container.addEventListener('click', (event) => this.handleClick(event));
    this.container.addEventListener('input', (event) => this.handleInput(event));
    this.container.addEventListener('change', (event) => this.handleChange(event));
    this.container.addEventListener('error', (event) => this.handleThumbnailError(event), true);
  }

  /**
   * The preset cards come from a module constant and never depend on project state,
   * so only the first render builds markup. Preset layers are deliberately not read
   * here because graph-backed presets compile lazily when they are applied.
   */
  public render(state: Readonly<ProjectState>): void {
    if (this.built) {
      this.syncState(state);
      return;
    }
    this.built = true;
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

      <section class="library-section preview-library-section">
        <div class="section-heading">
          <span>Preview object</span>
          <span class="asset-chip" data-role="asset-chip"${state.importedAssetName === null ? ' hidden' : ''}>${escapeHtml(state.importedAssetName ?? '')}</span>
        </div>
        <div class="object-grid compact-object-grid" role="group" aria-label="Preview object">
          ${OBJECT_PRESETS.map((item) => `
            <button
              class="object-tile compact-object-tile ${state.importedAssetName === null && state.selectedObject === item.id ? 'is-active' : ''}"
              data-object="${item.id}"
              data-tooltip="${escapeHtml(item.label)}"
              title="${escapeHtml(item.label)}"
              aria-label="Preview ${escapeHtml(item.label)}"
            >
              <span class="object-glyph" aria-hidden="true">${escapeHtml(item.glyph)}</span>
            </button>
          `).join('')}
        </div>

        <div class="preset-file-actions" role="group" aria-label="Share material preset">
          <button class="preset-file-button" data-action="load-preset" title="Load a shared material preset from disk">
            <span aria-hidden="true">⇧</span>
            <span>Load preset</span>
          </button>
          <button class="preset-file-button" data-action="save-preset" title="Save the current material preset to disk">
            <span aria-hidden="true">⇩</span>
            <span>Save preset</span>
          </button>
          <input
            class="visually-hidden"
            data-action="preset-file"
            type="file"
            accept=".json,application/json"
            aria-label="Load shared material preset"
          >
        </div>
        <div class="preset-file-status" data-role="preset-file-status" aria-live="polite"></div>
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

  /** Updates only the parts of the panel that actually depend on project state. */
  private syncState(state: Readonly<ProjectState>): void {
    const chip = this.container.querySelector<HTMLElement>('[data-role="asset-chip"]');
    if (chip !== null) {
      chip.hidden = state.importedAssetName === null;
      chip.textContent = state.importedAssetName ?? '';
    }

    const usingImported = state.importedAssetName !== null;
    for (const tile of this.container.querySelectorAll<HTMLElement>('[data-object]')) {
      tile.classList.toggle(
        'is-active',
        !usingImported && tile.dataset.object === state.selectedObject
      );
    }
  }

  private presetCard(preset: MaterialPreset): string {
    const tags = preset.tags.join(' ');
    return `
      <button
        class="preset-card"
        data-preset="${escapeHtml(preset.id)}"
        data-tags="${escapeHtml(tags)}"
        data-search="${escapeHtml(`${preset.name} ${preset.description} ${tags}`.toLowerCase())}"
      >
        <span
          class="preset-swatch has-thumbnail"
          data-role="preset-thumb"
          aria-hidden="true"
          style="--swatch-a:${FALLBACK_SWATCH_A};--swatch-b:${FALLBACK_SWATCH_B}"
        ><img src="${escapeHtml(presetThumbnailUrl(preset.id))}" width="144" height="144" loading="lazy" decoding="async" alt="" aria-hidden="true" data-preset-thumbnail></span>
        <span class="preset-copy">
          <strong>${escapeHtml(preset.name)}</strong>
          <small>${escapeHtml(preset.description)}</small>
          <span class="preset-card-tags">${preset.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</span>
        </span>
        <span class="preset-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  private handleThumbnailError(event: Event): void {
    if (!(event.target instanceof HTMLImageElement) || !event.target.hasAttribute('data-preset-thumbnail')) return;
    event.target.closest('.preset-swatch')?.classList.remove('has-thumbnail');
    event.target.remove();
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

    if (target.closest('[data-action="load-preset"]') !== null) {
      this.container.querySelector<HTMLInputElement>('[data-action="preset-file"]')?.click();
      return;
    }

    if (target.closest('[data-action="save-preset"]') !== null) {
      this.savePreset();
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

  private handleChange(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.action !== 'preset-file') return;

    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) void this.loadPreset(file);
  }

  private savePreset(): void {
    const requestedName = window.prompt('Preset name', 'Shared Material');
    if (requestedName === null) return;

    try {
      const content = serializeMaterialPresetFile(this.callbacks.getProjectState(), requestedName);
      const parsed = parseMaterialPresetFile(JSON.parse(content) as unknown);
      downloadText(`${presetFileStem(parsed.name)}${PRESET_FILE_SUFFIX}`, content);
      this.setPresetFileStatus(`Saved ${parsed.name}.`, 'info');
    } catch (error) {
      console.error('Material preset save failed.', error);
      this.setPresetFileStatus(this.errorMessage(error), 'error');
    }
  }

  private async loadPreset(file: File): Promise<void> {
    try {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        const limitMiB = MAX_PROJECT_FILE_BYTES / BYTES_PER_MIB;
        throw new Error(`Preset file exceeds the configured ${limitMiB.toFixed(1)} MiB limit.`);
      }
      const preset = parseMaterialPresetFile(JSON.parse(await file.text()) as unknown);
      this.callbacks.onPreset(preset);
      this.setPresetFileStatus(`Loaded ${preset.name}.`, 'info');
    } catch (error) {
      console.error('Material preset load failed.', error);
      this.setPresetFileStatus(this.errorMessage(error), 'error');
    }
  }

  private setPresetFileStatus(message: string, kind: 'info' | 'error'): void {
    const status = this.container.querySelector<HTMLElement>('[data-role="preset-file-status"]');
    if (status === null) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Material preset operation failed.';
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
