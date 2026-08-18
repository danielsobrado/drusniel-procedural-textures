import { LAYER_KINDS, MAX_LAYERS } from '../app/constants';
import type { LayerKind, ProjectState } from '../materials/types';

export interface LayerStripCallbacks {
  onAdd: (kind: LayerKind) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (id: string, targetIndex: number) => void;
}

export class LayerStrip {
  private draggedLayerId: string | null = null;

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: LayerStripCallbacks
  ) {
    this.container.addEventListener('click', (event) => this.handleClick(event));
    this.container.addEventListener('dragstart', (event) => this.handleDragStart(event));
    this.container.addEventListener('dragover', (event) => event.preventDefault());
    this.container.addEventListener('drop', (event) => this.handleDrop(event));
  }

  public render(state: Readonly<ProjectState>): void {
    this.container.innerHTML = `
      <div class="layer-dock-heading">
        <div>
          <span class="eyebrow">Material stack</span>
          <strong>${state.layers.length} / ${MAX_LAYERS} layers</strong>
        </div>
        <details class="add-layer-menu">
          <summary class="compact-button">＋ Layer</summary>
          <div class="popup-menu">
            ${LAYER_KINDS.map((kind) => `
              <button data-add-layer="${kind.id}">${kind.label}</button>
            `).join('')}
          </div>
        </details>
      </div>

      <div class="layer-scroll">
        ${state.layers.map((layer, index) => `
          <article
            class="layer-card ${state.selectedLayerId === layer.id ? 'is-selected' : ''} ${layer.enabled ? '' : 'is-disabled'}"
            draggable="true"
            data-layer-id="${layer.id}"
            data-layer-index="${index}"
          >
            <button class="layer-visibility" data-action="toggle" title="Toggle layer">${layer.enabled ? '●' : '○'}</button>
            <button class="layer-main" data-action="select">
              <span class="layer-swatch" style="--layer-a:${layer.colorA};--layer-b:${layer.colorB}"></span>
              <span class="layer-copy">
                <strong>${this.escape(layer.name)}</strong>
                <small>${layer.kind} · ${Math.round(layer.opacity * 100)}%</small>
              </span>
            </button>
            <div class="layer-card-actions">
              <button data-action="move-left" title="Move layer left" ${index === 0 ? 'disabled' : ''}>‹</button>
              <button data-action="move-right" title="Move layer right" ${index === state.layers.length - 1 ? 'disabled' : ''}>›</button>
              <span class="layer-action-spacer"></span>
              <button data-action="duplicate" title="Duplicate">⧉</button>
              <button data-action="remove" title="Delete">×</button>
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) {
      return;
    }

    const addButton = target.closest<HTMLElement>('[data-add-layer]');
    if (addButton?.dataset.addLayer !== undefined) {
      this.callbacks.onAdd(addButton.dataset.addLayer as LayerKind);
      const details = addButton.closest('details');
      if (details instanceof HTMLDetailsElement) {
        details.open = false;
      }
      return;
    }

    const card = target.closest<HTMLElement>('[data-layer-id]');
    const layerId = card?.dataset.layerId;
    const layerIndex = Number(card?.dataset.layerIndex);
    if (layerId === undefined) {
      return;
    }

    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'toggle') {
      this.callbacks.onToggle(layerId, card?.classList.contains('is-disabled') ?? false);
    } else if (action === 'move-left' && Number.isInteger(layerIndex)) {
      this.callbacks.onReorder(layerId, layerIndex - 1);
    } else if (action === 'move-right' && Number.isInteger(layerIndex)) {
      this.callbacks.onReorder(layerId, layerIndex + 1);
    } else if (action === 'duplicate') {
      this.callbacks.onDuplicate(layerId);
    } else if (action === 'remove') {
      this.callbacks.onRemove(layerId);
    } else {
      this.callbacks.onSelect(layerId);
    }
  }

  private handleDragStart(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest<HTMLElement>('[data-layer-id]');
    this.draggedLayerId = card?.dataset.layerId ?? null;

    if (event.dataTransfer !== null && this.draggedLayerId !== null) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.draggedLayerId);
    }
  }

  private handleDrop(event: DragEvent): void {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest<HTMLElement>('[data-layer-index]');
    const targetIndex = Number(card?.dataset.layerIndex);
    const layerId = this.draggedLayerId ?? event.dataTransfer?.getData('text/plain') ?? null;

    if (layerId !== null && Number.isInteger(targetIndex)) {
      this.callbacks.onReorder(layerId, targetIndex);
    }

    this.draggedLayerId = null;
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }
}
