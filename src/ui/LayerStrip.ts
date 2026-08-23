import { LAYER_KINDS, MAX_LAYERS } from '../app/constants';
import type { LayerKind, ProjectState } from '../materials/types';
import { escapeHtml } from '../utils/html';

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
  private structureKey = '';

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: LayerStripCallbacks
  ) {
    this.container.addEventListener('click', (event) => this.handleClick(event));
    this.container.addEventListener('dragstart', (event) => this.handleDragStart(event));
    this.container.addEventListener('dragover', (event) => event.preventDefault());
    this.container.addEventListener('drop', (event) => this.handleDrop(event));
    this.container.addEventListener('dragend', () => { this.draggedLayerId = null; });
  }

  public render(state: Readonly<ProjectState>): void {
    const nextStructureKey = state.layers.map((layer) => layer.id).join('|');
    if (this.structureKey !== nextStructureKey) {
      this.structureKey = nextStructureKey;
      this.build(state);
      return;
    }
    this.sync(state);
  }

  private build(state: Readonly<ProjectState>): void {
    const groups = new Map(state.groups.map((group) => [group.id, group.name]));
    this.container.innerHTML = `
      <div class="layer-dock-heading">
        <div>
          <span class="eyebrow">Material stack</span>
          <strong data-role="layer-count">${state.layers.length} / ${MAX_LAYERS} layers · ${state.groups.length} groups</strong>
        </div>
        <details class="add-layer-menu">
          <summary class="compact-button">＋ Layer</summary>
          <div class="popup-menu">
            ${LAYER_KINDS.map((kind) => `<button data-add-layer="${kind.id}">${escapeHtml(kind.label)}</button>`).join('')}
          </div>
        </details>
      </div>

      <div class="layer-scroll">
        ${state.layers.map((layer, index) => this.layerCard(layer, index, state, groups)).join('')}
      </div>
    `;
  }

  private layerCard(
    layer: Readonly<ProjectState['layers'][number]>,
    index: number,
    state: Readonly<ProjectState>,
    groups: ReadonlyMap<string, string>
  ): string {
    const groupName = layer.groupId === null ? null : groups.get(layer.groupId) ?? null;
    const routing = groupName === null
      ? `${layer.kind} · ${layer.channel}`
      : `${layer.kind} · ${layer.channel} · ${groupName}`;
    return `
      <article
        class="layer-card ${state.selectedLayerId === layer.id ? 'is-selected' : ''} ${layer.enabled ? '' : 'is-disabled'}"
        draggable="true"
        data-layer-id="${layer.id}"
        data-layer-index="${index}"
      >
        <button class="layer-visibility" data-action="toggle" aria-label="${layer.enabled ? 'Disable' : 'Enable'} ${escapeHtml(layer.name)}" title="Toggle layer">${layer.enabled ? '●' : '○'}</button>
        <button class="layer-main" data-action="select" aria-label="Edit ${escapeHtml(layer.name)}">
          <span class="layer-swatch" aria-hidden="true" style="--layer-a:${layer.colorA};--layer-b:${layer.colorB}"></span>
          <span class="layer-copy">
            <strong>${escapeHtml(layer.name)}</strong>
            <small>${escapeHtml(routing)} · ${Math.round(layer.opacity * 100)}%</small>
          </span>
        </button>
        <div class="layer-card-actions">
          <button data-action="move-left" aria-label="Move ${escapeHtml(layer.name)} left" title="Move layer left" ${index === 0 ? 'disabled' : ''}>‹</button>
          <button data-action="move-right" aria-label="Move ${escapeHtml(layer.name)} right" title="Move layer right" ${index === state.layers.length - 1 ? 'disabled' : ''}>›</button>
          <span class="layer-action-spacer"></span>
          <button data-action="duplicate" aria-label="Duplicate ${escapeHtml(layer.name)}" title="Duplicate">⧉</button>
          <button data-action="remove" aria-label="Delete ${escapeHtml(layer.name)}" title="Delete">×</button>
        </div>
      </article>
    `;
  }

  private sync(state: Readonly<ProjectState>): void {
    const count = this.container.querySelector<HTMLElement>('[data-role="layer-count"]');
    if (count !== null) {
      count.textContent = `${state.layers.length} / ${MAX_LAYERS} layers · ${state.groups.length} groups`;
    }

    const groups = new Map(state.groups.map((group) => [group.id, group.name]));
    state.layers.forEach((layer, index) => {
      const card = this.container.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(layer.id)}"]`);
      if (card === null) return;
      card.dataset.layerIndex = String(index);
      card.classList.toggle('is-selected', state.selectedLayerId === layer.id);
      card.classList.toggle('is-disabled', !layer.enabled);

      const visibility = card.querySelector<HTMLButtonElement>('[data-action="toggle"]');
      if (visibility !== null) {
        visibility.textContent = layer.enabled ? '●' : '○';
        visibility.setAttribute('aria-label', `${layer.enabled ? 'Disable' : 'Enable'} ${layer.name}`);
      }

      const main = card.querySelector<HTMLButtonElement>('[data-action="select"]');
      main?.setAttribute('aria-label', `Edit ${layer.name}`);
      const swatch = card.querySelector<HTMLElement>('.layer-swatch');
      swatch?.style.setProperty('--layer-a', layer.colorA);
      swatch?.style.setProperty('--layer-b', layer.colorB);
      const name = card.querySelector<HTMLElement>('.layer-copy strong');
      if (name !== null) name.textContent = layer.name;
      const groupName = layer.groupId === null ? null : groups.get(layer.groupId) ?? null;
      const routing = groupName === null
        ? `${layer.kind} · ${layer.channel}`
        : `${layer.kind} · ${layer.channel} · ${groupName}`;
      const summary = card.querySelector<HTMLElement>('.layer-copy small');
      if (summary !== null) summary.textContent = `${routing} · ${Math.round(layer.opacity * 100)}%`;

      const moveLeft = card.querySelector<HTMLButtonElement>('[data-action="move-left"]');
      const moveRight = card.querySelector<HTMLButtonElement>('[data-action="move-right"]');
      if (moveLeft !== null) {
        moveLeft.disabled = index === 0;
        moveLeft.setAttribute('aria-label', `Move ${layer.name} left`);
      }
      if (moveRight !== null) {
        moveRight.disabled = index === state.layers.length - 1;
        moveRight.setAttribute('aria-label', `Move ${layer.name} right`);
      }
      card.querySelector<HTMLButtonElement>('[data-action="duplicate"]')
        ?.setAttribute('aria-label', `Duplicate ${layer.name}`);
      card.querySelector<HTMLButtonElement>('[data-action="remove"]')
        ?.setAttribute('aria-label', `Delete ${layer.name}`);
    });
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;

    const addButton = target.closest<HTMLElement>('[data-add-layer]');
    if (addButton?.dataset.addLayer !== undefined) {
      this.callbacks.onAdd(addButton.dataset.addLayer as LayerKind);
      const details = addButton.closest('details');
      if (details instanceof HTMLDetailsElement) details.open = false;
      return;
    }

    const card = target.closest<HTMLElement>('[data-layer-id]');
    const layerId = card?.dataset.layerId;
    const layerIndex = Number(card?.dataset.layerIndex);
    if (layerId === undefined) return;

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
}
