import { TILE_CONFIG } from '../config/tileConfig';
import { measureEdgeMismatch } from '../export/SeamlessTexture';
import type { BakedTextureSet } from '../export/TextureBaker';

interface TilePreviewCallbacks {
  onClose: () => void;
  onRefresh: () => void;
  onSave: () => void;
}

type TileChannel =
  | 'albedo'
  | 'roughness'
  | 'normal'
  | 'height'
  | 'clearcoat'
  | 'clearcoatRoughness';

const CHANNELS: ReadonlyArray<{ id: TileChannel; label: string }> = [
  { id: 'albedo', label: 'Albedo' },
  { id: 'roughness', label: 'Roughness' },
  { id: 'normal', label: 'Normal' },
  { id: 'height', label: 'Height' },
  { id: 'clearcoat', label: 'Clearcoat' },
  { id: 'clearcoatRoughness', label: 'Coat roughness' }
];

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing required tile preview element: ${selector}`);
  return element;
}

function isTileChannel(value: string): value is TileChannel {
  return CHANNELS.some((channel) => channel.id === value);
}

function tileOptions(): string {
  const config = TILE_CONFIG;
  const options: string[] = [];
  for (let count = config.minPreviewTiles; count <= config.maxPreviewTiles; count += 1) {
    options.push(`<option value="${count}">${count} × ${count}</option>`);
  }
  return options.join('');
}

function channelOptions(): string {
  return CHANNELS.map((channel) => `<option value="${channel.id}">${channel.label}</option>`).join('');
}

export class TilePreviewPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly channelSelect: HTMLSelectElement;
  private readonly tileSelect: HTMLSelectElement;
  private readonly gridInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly metrics: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver;
  private textures: BakedTextureSet | null = null;
  private channel: TileChannel = 'albedo';
  private tileCount: number = TILE_CONFIG.previewTiles;
  private showGrid = false;
  private invalidatedDuringLoad = false;

  public constructor(
    private readonly root: HTMLElement,
    callbacks: Readonly<TilePreviewCallbacks>
  ) {
    this.root.innerHTML = `
      <div class="tile-preview-toolbar">
        <div class="tile-preview-title">
          <span class="eyebrow">Seamless export</span>
          <strong>Tile Lab</strong>
          <span data-role="tile-status">Generate a tile preview</span>
        </div>
        <div class="tile-preview-actions">
          <label class="tile-preview-control">
            <span>Channel</span>
            <select data-role="tile-channel">${channelOptions()}</select>
          </label>
          <label class="tile-preview-control">
            <span>Tiles</span>
            <select data-role="tile-count">${tileOptions()}</select>
          </label>
          <label class="tile-preview-grid-toggle">
            <input data-role="tile-grid" type="checkbox">
            <span>Seam guides</span>
          </label>
          <button class="compact-button" data-role="tile-refresh" type="button">Refresh</button>
          <button class="compact-button tile-save-button" data-role="tile-save" type="button">Save tileable</button>
          <button class="icon-button" data-role="tile-close" type="button" aria-label="Close tile lab" title="Close">×</button>
        </div>
      </div>
      <div class="tile-preview-stage" data-role="tile-stage">
        <canvas data-role="tile-canvas" aria-label="Repeated seamless texture preview"></canvas>
        <div class="tile-preview-empty" data-role="tile-empty">Generate a preview to inspect repeated seams.</div>
      </div>
      <div class="tile-preview-footer">
        <span data-role="tile-metrics">Preview not generated</span>
        <span>${TILE_CONFIG.worldSize.toFixed(2)} world units · ${(TILE_CONFIG.blendFraction * 100).toFixed(0)}% edge blend</span>
      </div>
    `;

    this.canvas = required(this.root, '[data-role="tile-canvas"]');
    this.channelSelect = required(this.root, '[data-role="tile-channel"]');
    this.tileSelect = required(this.root, '[data-role="tile-count"]');
    this.gridInput = required(this.root, '[data-role="tile-grid"]');
    this.status = required(this.root, '[data-role="tile-status"]');
    this.metrics = required(this.root, '[data-role="tile-metrics"]');
    this.empty = required(this.root, '[data-role="tile-empty"]');
    this.refreshButton = required(this.root, '[data-role="tile-refresh"]');
    this.saveButton = required(this.root, '[data-role="tile-save"]');
    const closeButton = required<HTMLButtonElement>(this.root, '[data-role="tile-close"]');
    const stage = required<HTMLElement>(this.root, '[data-role="tile-stage"]');

    this.channelSelect.value = this.channel;
    this.tileSelect.value = String(this.tileCount);
    this.channelSelect.addEventListener('change', () => {
      if (!isTileChannel(this.channelSelect.value)) {
        this.channelSelect.value = this.channel;
        return;
      }
      this.channel = this.channelSelect.value;
      this.updateMetrics();
      this.render();
    });
    this.tileSelect.addEventListener('change', () => {
      const value = Number.parseInt(this.tileSelect.value, 10);
      if (
        !Number.isInteger(value) ||
        value < TILE_CONFIG.minPreviewTiles ||
        value > TILE_CONFIG.maxPreviewTiles
      ) {
        this.tileSelect.value = String(this.tileCount);
        return;
      }
      this.tileCount = value;
      this.render();
    });
    this.gridInput.addEventListener('change', () => {
      this.showGrid = this.gridInput.checked;
      this.render();
    });
    this.refreshButton.addEventListener('click', callbacks.onRefresh);
    this.saveButton.addEventListener('click', callbacks.onSave);
    closeButton.addEventListener('click', callbacks.onClose);

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(stage);
  }

  public setLoading(message: string): void {
    this.invalidatedDuringLoad = false;
    this.root.setAttribute('aria-busy', 'true');
    this.status.textContent = message;
    this.refreshButton.disabled = true;
    this.saveButton.disabled = true;
    if (this.textures === null) this.empty.textContent = message;
  }

  public setMaps(textures: BakedTextureSet): void {
    const preserveStale = this.invalidatedDuringLoad || (
      this.textures === textures && this.root.dataset.stale === 'true'
    );
    this.textures = textures;
    this.invalidatedDuringLoad = false;
    this.root.setAttribute('aria-busy', 'false');
    this.root.dataset.stale = preserveStale ? 'true' : 'false';
    this.status.textContent = preserveStale
      ? 'Material changed during generation · refresh preview'
      : 'Seam-locked preview ready';
    this.updateMetrics();
    this.empty.hidden = true;
    this.refreshButton.disabled = false;
    this.saveButton.disabled = false;
    this.render();
  }

  public markStale(): void {
    if (this.root.getAttribute('aria-busy') === 'true') {
      this.invalidatedDuringLoad = true;
      this.root.dataset.stale = 'true';
      this.status.textContent = 'Material changed during generation · refresh when ready';
      return;
    }
    if (this.textures === null) return;
    this.root.setAttribute('aria-busy', 'false');
    this.root.dataset.stale = 'true';
    this.status.textContent = 'Material changed · refresh preview';
    this.refreshButton.disabled = false;
    this.saveButton.disabled = false;
  }

  public setError(message: string): void {
    this.invalidatedDuringLoad = false;
    this.root.setAttribute('aria-busy', 'false');
    this.status.textContent = 'Tile generation failed';
    this.empty.hidden = this.textures !== null;
    if (this.textures === null) this.empty.textContent = message;
    this.refreshButton.disabled = false;
    this.saveButton.disabled = false;
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
  }

  private updateMetrics(): void {
    const textures = this.textures;
    if (textures === null) {
      this.metrics.textContent = 'Preview not generated';
      return;
    }

    const channel = CHANNELS.find((entry) => entry.id === this.channel);
    const mismatch = measureEdgeMismatch(textures[this.channel].canvas) * 100;
    this.metrics.textContent = `${textures.resolution}² · seam mismatch ${mismatch.toFixed(3)}% · ${channel?.label ?? this.channel}`;
  }

  private render(): void {
    const textures = this.textures;
    if (textures === null) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    const context = this.canvas.getContext('2d');
    if (context === null) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b0e13';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const gridSize = Math.min(width, height) * 0.94;
    const tileSize = gridSize / this.tileCount;
    const startX = (width - gridSize) * 0.5;
    const startY = (height - gridSize) * 0.5;
    const source = textures[this.channel].canvas;

    for (let y = 0; y < this.tileCount; y += 1) {
      for (let x = 0; x < this.tileCount; x += 1) {
        context.drawImage(
          source,
          startX + x * tileSize,
          startY + y * tileSize,
          tileSize,
          tileSize
        );
      }
    }

    if (!this.showGrid) return;
    context.save();
    context.strokeStyle = 'rgba(226, 232, 255, 0.38)';
    context.lineWidth = Math.max(1, pixelRatio);
    for (let index = 0; index <= this.tileCount; index += 1) {
      const x = startX + index * tileSize;
      const y = startY + index * tileSize;
      context.beginPath();
      context.moveTo(x, startY);
      context.lineTo(x, startY + gridSize);
      context.stroke();
      context.beginPath();
      context.moveTo(startX, y);
      context.lineTo(startX + gridSize, y);
      context.stroke();
    }
    context.restore();
  }
}
