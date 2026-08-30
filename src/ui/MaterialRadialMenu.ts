import '../styles/terrain-material-radial.css';
import { presetThumbnailUrl } from '../assets/PresetAssets';
import { UI_CONFIG } from '../app/constants';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { MATERIAL_PRESETS } from '../materials/presets';
import type { MaterialPreset } from '../materials/types';
import type { TerrainBaseMaterialId } from '../tile/TerrainTypes';
import { escapeHtml } from '../utils/html';
import {
  MATERIAL_CATEGORIES,
  categoryOf,
  presetsInCategory,
  searchPresets
} from './materialCategories';
import { ringSlotPosition, safeCenter } from './radialGeometry';

/** The spare inner-ring slot: everything, and the entry point for type-to-filter. */
const ALL_CATEGORY_ID = 'all';

export interface MaterialRadialTarget {
  material: TerrainBaseMaterialId;
  label: string;
  currentPresetId: string | null;
  metersPerTile: number;
  anchorX: number;
  anchorY: number;
}

export interface MaterialRadialCallbacks {
  /** Fired after the dwell delay, and with null when the pointer leaves the ring. */
  onHover: (presetId: string | null) => void;
  /** An empty id clears the slot back to its built-in procedural material. */
  onCommit: (presetId: string) => void;
  onCancel: () => void;
}

function presetById(id: string): MaterialPreset | null {
  return MATERIAL_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Two concentric rings, both live: the inner picks a category, the outer fills with that
 * category's presets as thumbnails.
 *
 * Not a drill-down. Both rings fit on screen at once, so swapping views would add a mode and
 * a Back affordance for nothing. Not a flat paged ring either: 73 presets over seven pages
 * destroys the spatial memory that makes a radial menu worth using in the first place.
 */
export class MaterialRadialMenu {
  private readonly host: HTMLElement;
  private target: MaterialRadialTarget | null = null;
  private activeCategoryId: string = MATERIAL_CATEGORIES[0]?.id ?? ALL_CATEGORY_ID;
  private page = 0;
  private query = '';
  private hoveredPresetId: string | null = null;
  private dwellTimer = 0;
  private previousFocus: HTMLElement | null = null;
  private visible = false;

  public constructor(private readonly callbacks: Readonly<MaterialRadialCallbacks>) {
    this.host = document.createElement('div');
    this.host.className = 'material-radial-host';
    document.body.append(this.host);
    this.host.addEventListener('click', (event) => this.handleClick(event));
    this.host.addEventListener('pointerover', (event) => this.handlePointerOver(event));
    this.host.addEventListener('focusin', (event) => this.handleFocusIn(event));
    this.host.addEventListener('pointerleave', () => this.setHovered(null));
    this.host.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false });
    window.addEventListener('keydown', this.handleKeyDown);
  }

  public get isOpen(): boolean {
    return this.visible;
  }

  public open(target: MaterialRadialTarget, focusFirst = true): void {
    this.target = target;
    this.query = '';
    this.page = 0;
    this.hoveredPresetId = null;
    const current = target.currentPresetId === null ? null : presetById(target.currentPresetId);
    this.activeCategoryId = current === null
      ? this.activeCategoryId
      : categoryOf(current)?.id ?? this.activeCategoryId;
    this.previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.visible = true;
    this.render();
    this.host.classList.add('is-open');
    if (focusFirst) this.focusPresetIndex(0);
  }

  public hide(): void {
    if (!this.visible) return;
    this.clearDwell();
    this.visible = false;
    this.host.classList.remove('is-open');
    this.host.replaceChildren();
    this.target = null;
    const previousFocus = this.previousFocus;
    this.previousFocus = null;
    previousFocus?.focus({ preventScroll: true });
  }

  public dispose(): void {
    this.clearDwell();
    window.removeEventListener('keydown', this.handleKeyDown);
    this.host.remove();
  }

  private get entries(): readonly MaterialPreset[] {
    if (this.query !== '') return searchPresets(this.query);
    if (this.activeCategoryId === ALL_CATEGORY_ID) return MATERIAL_PRESETS;
    return presetsInCategory(this.activeCategoryId);
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(this.entries.length / TERRAIN_CONFIG.radial.presetsPerPage));
  }

  private render(): void {
    const target = this.target;
    if (target === null) return;
    const radius = TERRAIN_CONFIG.radial.outerRadiusPx;
    // The 72px outer petals extend 36px past the radius. The extra 46px also covers their
    // focus growth and shadow, so a picker opened at an edge never clips a choice.
    const margin = radius + 46 + UI_CONFIG.radialEdgePaddingPx;
    const x = safeCenter(target.anchorX, window.innerWidth, margin);
    const y = safeCenter(target.anchorY, window.innerHeight, margin);

    this.host.innerHTML = `
      <div class="material-radial-backdrop" data-radial-dismiss></div>
      <div class="material-radial" role="dialog" aria-modal="true"
        aria-label="Choose a material for ${escapeHtml(target.label)}"
        style="left:${x}px;top:${y}px;--radial-size:${(radius + 46) * 2}px">
        ${this.renderHub(target)}
        <div class="material-radial-ring" role="radiogroup" aria-label="Category">
          ${this.renderCategories(radius * 0.5625)}
        </div>
        <div class="material-radial-ring" role="listbox"
          aria-label="${escapeHtml(this.activeLabel())}">
          ${this.renderPresets(radius)}
        </div>
      </div>
    `;
  }

  private activeLabel(): string {
    if (this.query !== '') return `Search results for ${this.query}`;
    if (this.activeCategoryId === ALL_CATEGORY_ID) return 'All presets';
    return MATERIAL_CATEGORIES.find((c) => c.id === this.activeCategoryId)?.label ?? 'Presets';
  }

  private renderHub(target: MaterialRadialTarget): string {
    const shown = this.hoveredPresetId ?? target.currentPresetId;
    const preset = shown === null ? null : presetById(shown);
    const pages = this.pageCount > 1
      ? `<span class="material-radial-page">Page ${this.page + 1} / ${this.pageCount}</span>`
      : '';
    const body = preset === null
      ? `<strong>Built-in ${escapeHtml(target.label)}</strong>
         <small>Procedural material · no preset assigned</small>`
      : `<strong>${escapeHtml(preset.name)}</strong>
         <small>${escapeHtml(preset.description)}</small>
         <span class="material-radial-tags">${preset.tags.slice(0, 3)
           .map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</span>`;
    const query = this.query === ''
      ? '<span class="material-radial-hint">Type to search · Esc to cancel</span>'
      : `<span class="material-radial-hint">Searching “${escapeHtml(this.query)}”</span>`;
    return `
      <div class="material-radial-hub">
        <div class="material-radial-hub-thumb"${preset === null
          ? ''
          : ` style="background-image:url(${escapeHtml(presetThumbnailUrl(preset.id))})"`}></div>
        <div class="material-radial-hub-copy" aria-live="polite">
          <span class="eyebrow">${escapeHtml(target.label)} · ${target.metersPerTile.toFixed(1)} m/tile</span>
          ${body}
        </div>
        ${query}
        ${pages}
        <button class="material-radial-reset" type="button" data-radial-preset=""
          title="Clear the assignment and use the built-in procedural material">
          Use built-in
        </button>
      </div>
    `;
  }

  private renderCategories(radius: number): string {
    const slots = [
      ...MATERIAL_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        glyph: category.glyph,
        count: presetsInCategory(category.id).length
      })),
      { id: ALL_CATEGORY_ID, label: 'All presets', glyph: '∗', count: MATERIAL_PRESETS.length }
    ];
    return slots.map((slot, index) => {
      const position = ringSlotPosition(index, slots.length, radius);
      const active = this.query === '' && slot.id === this.activeCategoryId;
      return `
        <button class="material-radial-category${active ? ' is-active' : ''}"
          role="radio" aria-checked="${active}" tabindex="${active ? '0' : '-1'}"
          data-radial-category="${escapeHtml(slot.id)}"
          title="${escapeHtml(slot.label)} · ${slot.count}"
          style="--radial-x:${position.x.toFixed(2)}px;--radial-y:${position.y.toFixed(2)}px">
          <span aria-hidden="true">${slot.glyph}</span>
          <small>${escapeHtml(slot.label)}</small>
        </button>
      `;
    }).join('');
  }

  private renderPresets(radius: number): string {
    const perPage = TERRAIN_CONFIG.radial.presetsPerPage;
    const entries = this.entries;
    const total = entries.length;
    const start = this.page * perPage;
    const shown = entries.slice(start, start + perPage);
    const hasMore = total > perPage;
    const slotCount = shown.length + (hasMore ? 1 : 0);

    const petals = shown.map((preset, index) => {
      const position = ringSlotPosition(index, slotCount, radius);
      const selected = preset.id === this.target?.currentPresetId;
      return `
        <button class="material-radial-preset${selected ? ' is-selected' : ''}"
          role="option" aria-selected="${selected}" tabindex="-1"
          aria-setsize="${total}" aria-posinset="${start + index + 1}"
          data-radial-preset="${escapeHtml(preset.id)}"
          title="${escapeHtml(preset.name)}"
          style="--radial-x:${position.x.toFixed(2)}px;--radial-y:${position.y.toFixed(2)}px">
          <span class="material-radial-thumb"
            style="background-image:url(${escapeHtml(presetThumbnailUrl(preset.id))})"></span>
          <small>${escapeHtml(preset.name)}</small>
        </button>
      `;
    });

    if (hasMore) {
      const position = ringSlotPosition(shown.length, slotCount, radius);
      petals.push(`
        <button class="material-radial-preset material-radial-more" type="button"
          tabindex="-1" data-radial-page="next"
          title="Show the next page of ${total} presets"
          style="--radial-x:${position.x.toFixed(2)}px;--radial-y:${position.y.toFixed(2)}px">
          <span class="material-radial-thumb" aria-hidden="true">▸</span>
          <small>More ${this.page + 1}/${this.pageCount}</small>
        </button>
      `);
    }
    return petals.join('');
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;

    if (target.closest('[data-radial-page]') !== null) {
      this.resetHoverPreview();
      this.page = (this.page + 1) % this.pageCount;
      this.render();
      this.focusPresetIndex(0);
      return;
    }
    const category = target.closest<HTMLElement>('[data-radial-category]');
    if (category !== null) {
      this.resetHoverPreview();
      this.activeCategoryId = category.dataset.radialCategory ?? ALL_CATEGORY_ID;
      this.query = '';
      this.page = 0;
      this.render();
      this.focusPresetIndex(0);
      return;
    }
    const preset = target.closest<HTMLElement>('[data-radial-preset]');
    if (preset !== null) {
      const presetId = preset.dataset.radialPreset ?? '';
      this.clearDwell();
      this.hide();
      this.callbacks.onCommit(presetId);
      return;
    }
    if (target.closest('[data-radial-dismiss]') !== null) this.cancel();
  }

  private handlePointerOver(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    const petal = target?.closest<HTMLElement>('[data-radial-preset]') ?? null;
    const presetId = petal?.dataset.radialPreset ?? null;
    this.setHovered(presetId === '' ? null : presetId);
  }

  private handleFocusIn(event: FocusEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const petal = target?.closest<HTMLElement>('.material-radial-preset[data-radial-preset]') ?? null;
    if (petal !== null) this.setHovered(petal.dataset.radialPreset ?? null);
    else if (target?.closest('[data-radial-category], [data-radial-page], .material-radial-reset') !== null) {
      this.setHovered(null);
    }
  }

  /**
   * Dwell before previewing. Sweeping the pointer across the ring on the way somewhere else
   * should not fire a fetch per petal it crosses.
   */
  private setHovered(presetId: string | null): void {
    if (presetId === this.hoveredPresetId) return;
    this.clearDwell();
    this.hoveredPresetId = presetId;
    this.refreshHub();
    if (presetId === null) {
      this.callbacks.onHover(null);
      return;
    }
    this.dwellTimer = window.setTimeout(() => {
      this.dwellTimer = 0;
      this.callbacks.onHover(presetId);
    }, TERRAIN_CONFIG.radial.hoverDwellMs);
  }

  private refreshHub(): void {
    const hub = this.host.querySelector('.material-radial-hub');
    const target = this.target;
    if (hub === null || target === null) return;
    hub.outerHTML = this.renderHub(target);
  }

  private clearDwell(): void {
    if (this.dwellTimer === 0) return;
    window.clearTimeout(this.dwellTimer);
    this.dwellTimer = 0;
  }

  /** Any ring mutation invalidates both the hub candidate and the world preview. */
  private resetHoverPreview(): void {
    const hadCandidate = this.hoveredPresetId !== null;
    this.clearDwell();
    this.hoveredPresetId = null;
    if (hadCandidate) this.callbacks.onHover(null);
  }

  private cancel(): void {
    this.clearDwell();
    this.hide();
    this.callbacks.onCancel();
  }

  private handleWheel(event: WheelEvent): void {
    if (!this.visible || this.pageCount <= 1) return;
    event.preventDefault();
    this.resetHoverPreview();
    this.page = (this.page + (event.deltaY > 0 ? 1 : this.pageCount - 1)) % this.pageCount;
    this.render();
    this.focusPresetIndex(0);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.visible) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.key === 'Enter' && this.hoveredPresetId !== null) {
      event.preventDefault();
      const presetId = this.hoveredPresetId;
      this.hide();
      this.callbacks.onCommit(presetId);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      this.resetHoverPreview();
      this.query = this.query.slice(0, -1);
      this.page = 0;
      this.render();
      this.focusPresetIndex(0);
      return;
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      this.resetHoverPreview();
      const step = event.key === 'PageDown' ? 1 : this.pageCount - 1;
      this.page = (this.page + step) % this.pageCount;
      this.render();
      this.focusPresetIndex(0);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      this.cycleFocus(event.shiftKey ? -1 : 1);
      return;
    }
    const inCategories = document.activeElement instanceof HTMLElement &&
      document.activeElement.matches('[data-radial-category]');
    const inPresets = document.activeElement instanceof HTMLElement &&
      document.activeElement.matches('.material-radial-preset');
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        if (inCategories) this.focusPresetIndex(this.nearestIndex(this.categories(), this.petals()));
        else if (inPresets) this.focusPresetIndex(this.offsetIndex(this.petals(), -1));
        else this.focusPresetIndex(0);
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (inPresets) this.focusCategoryIndex(this.nearestIndex(this.petals(), this.categories()));
        else if (inCategories) this.focusCategoryIndex(this.offsetIndex(this.categories(), 1));
        else this.focusCategoryIndex(0);
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        if (inCategories) this.focusCategoryIndex(this.offsetIndex(this.categories(), direction));
        else this.focusPresetIndex(this.offsetIndex(this.petals(), direction));
        return;
      }
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const collection = inCategories ? this.categories() : this.petals();
      const index = event.key === 'Home' ? 0 : collection.length - 1;
      if (inCategories) this.focusCategoryIndex(index);
      else this.focusPresetIndex(index);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') &&
        document.activeElement instanceof HTMLButtonElement &&
        this.host.contains(document.activeElement)) {
      event.preventDefault();
      document.activeElement.click();
      return;
    }
    // Any printable key turns the outer ring into search results: the escape hatch to a
    // full list without building a second piece of UI.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.resetHoverPreview();
      this.query += event.key;
      this.page = 0;
      this.render();
      this.focusPresetIndex(0);
    }
  };

  private petals(): HTMLButtonElement[] {
    return Array.from(this.host.querySelectorAll<HTMLButtonElement>(
      '.material-radial-ring[role="listbox"] .material-radial-preset'
    ));
  }

  private categories(): HTMLButtonElement[] {
    return Array.from(this.host.querySelectorAll<HTMLButtonElement>('[data-radial-category]'));
  }

  private offsetIndex(elements: readonly HTMLButtonElement[], direction: number): number {
    if (elements.length === 0) return -1;
    const active = document.activeElement instanceof HTMLButtonElement
      ? elements.indexOf(document.activeElement)
      : -1;
    return active < 0
      ? direction > 0 ? 0 : elements.length - 1
      : (active + direction + elements.length) % elements.length;
  }

  /** Maps the current angular position to the closest slot in the other ring. */
  private nearestIndex(from: readonly HTMLButtonElement[], to: readonly HTMLButtonElement[]): number {
    if (to.length === 0) return -1;
    const active = document.activeElement instanceof HTMLButtonElement
      ? Math.max(0, from.indexOf(document.activeElement))
      : 0;
    return Math.min(to.length - 1, Math.round(active / Math.max(1, from.length - 1) * (to.length - 1)));
  }

  private focusPresetIndex(index: number): void {
    const petal = this.petals()[index];
    if (petal === undefined) return;
    petal.focus({ preventScroll: true });
    this.setHovered(petal.dataset.radialPreset ?? null);
  }

  private focusCategoryIndex(index: number): void {
    const category = this.categories()[index];
    if (category === undefined) return;
    category.focus({ preventScroll: true });
    this.setHovered(null);
  }

  private cycleFocus(direction: number): void {
    const focusable = Array.from(this.host.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    if (focusable.length === 0) return;
    const active = document.activeElement instanceof HTMLButtonElement
      ? focusable.indexOf(document.activeElement)
      : -1;
    const next = active < 0
      ? direction > 0 ? 0 : focusable.length - 1
      : (active + direction + focusable.length) % focusable.length;
    focusable[next]?.focus({ preventScroll: true });
  }
}
