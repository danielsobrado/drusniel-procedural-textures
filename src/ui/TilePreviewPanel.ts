import { TILE_CONFIG } from '../config/tileConfig';
import { measureEdgeMismatch } from '../export/SeamlessTexture';
import type { BakedTextureSet } from '../export/TextureBaker';
import type { TerrainTileLabPanel } from './TerrainTileLabPanel';

interface TilePreviewCallbacks {
  onClose: () => void;
  onRefresh: () => void;
  onSave: () => void;
  onTextureRequested?: () => void;
}

type TileChannel = 'albedo' | 'roughness' | 'normal' | 'height' | 'clearcoat' | 'clearcoatRoughness';
type TileLabMode = 'terrain' | 'texture';

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
  const options: string[] = [];
  for (let count = TILE_CONFIG.minPreviewTiles; count <= TILE_CONFIG.maxPreviewTiles; count += 1) {
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
  private readonly textureActions: HTMLElement;
  private readonly textureView: HTMLElement;
  private readonly textureFooter: HTMLElement;
  private readonly terrainHost: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private terrainPanel: TerrainTileLabPanel | null = null;
  private terrainPanelPromise: Promise<TerrainTileLabPanel | null> | null = null;
  private disposed = false;
  private currentMaterialTextures: BakedTextureSet | null = null;
  private textures: BakedTextureSet | null = null;
  private channel: TileChannel = 'albedo';
  private tileCount: number = TILE_CONFIG.previewTiles;
  private showGrid = false;
  private invalidatedDuringLoad = false;
  private mode: TileLabMode = 'terrain';
  private textureStatus = 'Generate a tile preview';
  private terrainStatus = 'Procedural terrain, rivers and material painting';

  public constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: Readonly<TilePreviewCallbacks>
  ) {
    this.root.innerHTML = `
      <div class="tile-preview-toolbar">
        <div class="tile-preview-title">
          <span class="eyebrow">Procedural world authoring</span>
          <strong>Tile Lab</strong>
          <span data-role="tile-status">${this.terrainStatus}</span>
        </div>
        <div class="tile-preview-actions">
          <div class="tile-lab-mode-switch" role="tablist" aria-label="Tile Lab mode">
            <button class="is-active" data-tile-mode="terrain" type="button">Terrain</button>
            <button data-tile-mode="texture" type="button">Texture</button>
          </div>
          <div class="tile-texture-actions" data-role="tile-texture-actions" hidden>
            <label class="tile-preview-control"><span>Channel</span><select data-role="tile-channel">${channelOptions()}</select></label>
            <label class="tile-preview-control"><span>Tiles</span><select data-role="tile-count">${tileOptions()}</select></label>
            <label class="tile-preview-grid-toggle"><input data-role="tile-grid" type="checkbox"><span>Seam guides</span></label>
            <button class="compact-button" data-role="tile-refresh" type="button">Refresh</button>
            <button class="compact-button tile-save-button" data-role="tile-save" type="button">Save tileable</button>
          </div>
          <button class="icon-button" data-role="tile-close" type="button" aria-label="Close tile lab" title="Close">×</button>
        </div>
      </div>
      <div class="tile-preview-stage" data-role="tile-stage">
        <div class="tile-texture-view" data-role="tile-texture-view" hidden>
          <canvas data-role="tile-canvas" aria-label="Repeated seamless texture preview"></canvas>
          <div class="tile-preview-empty" data-role="tile-empty">Generate a preview to inspect repeated seams.</div>
        </div>
        <div class="terrain-tile-host" data-role="terrain-tile-host"></div>
      </div>
      <div class="tile-preview-footer" data-role="tile-texture-footer" hidden>
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
    this.textureActions = required(this.root, '[data-role="tile-texture-actions"]');
    this.textureView = required(this.root, '[data-role="tile-texture-view"]');
    this.textureFooter = required(this.root, '[data-role="tile-texture-footer"]');
    this.terrainHost = required(this.root, '[data-role="terrain-tile-host"]');
    const closeButton = required<HTMLButtonElement>(this.root, '[data-role="tile-close"]');

    this.channelSelect.value = this.channel;
    this.tileSelect.value = String(this.tileCount);
    this.channelSelect.addEventListener('change', () => {
      if (!isTileChannel(this.channelSelect.value)) { this.channelSelect.value = this.channel; return; }
      this.channel = this.channelSelect.value;
      this.updateMetrics();
      this.render();
    });
    this.tileSelect.addEventListener('change', () => {
      const value = Number.parseInt(this.tileSelect.value, 10);
      if (!Number.isInteger(value) || value < TILE_CONFIG.minPreviewTiles || value > TILE_CONFIG.maxPreviewTiles) {
        this.tileSelect.value = String(this.tileCount);
        return;
      }
      this.tileCount = value;
      this.render();
    });
    this.gridInput.addEventListener('change', () => { this.showGrid = this.gridInput.checked; this.render(); });
    this.refreshButton.addEventListener('click', this.callbacks.onRefresh);
    this.saveButton.addEventListener('click', this.callbacks.onSave);
    closeButton.addEventListener('click', this.callbacks.onClose);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tile-mode]')) {
      button.addEventListener('click', () => this.setMode(button.dataset.tileMode === 'texture' ? 'texture' : 'terrain'));
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.root.getBoundingClientRect().width > 0 && this.mode === 'terrain') void this.ensureTerrainPanel();
      this.render();
    });
    this.resizeObserver.observe(this.root);
    this.setMode('terrain');
  }

  public get textureModeActive(): boolean {
    return this.mode === 'texture';
  }

  public setLoading(message: string): void {
    this.invalidatedDuringLoad = false;
    this.root.setAttribute('aria-busy', 'true');
    this.textureStatus = message;
    if (this.mode === 'texture') this.status.textContent = message;
    this.refreshButton.disabled = true;
    this.saveButton.disabled = true;
    if (this.textures === null) this.empty.textContent = message;
  }

  public setMaps(textures: BakedTextureSet): void {
    const preserveStale = this.invalidatedDuringLoad || (this.textures === textures && this.root.dataset.stale === 'true');
    this.textures = textures;
    this.invalidatedDuringLoad = false;
    this.root.setAttribute('aria-busy', 'false');
    this.root.dataset.stale = preserveStale ? 'true' : 'false';
    this.textureStatus = preserveStale ? 'Material changed during generation · refresh preview' : 'Seam-locked preview ready';
    if (this.mode === 'texture') this.status.textContent = this.textureStatus;
    this.updateMetrics();
    this.empty.hidden = true;
    this.refreshButton.disabled = false;
    this.saveButton.disabled = preserveStale;
    if (preserveStale) {
      this.currentMaterialTextures = null;
      this.terrainPanel?.clearCurrentMaterialTexture();
    } else {
      this.currentMaterialTextures = textures;
      this.terrainPanel?.setCurrentMaterialTextures(this.currentMaterialTextures);
    }
    this.render();
  }

  public markStale(): void {
    this.currentMaterialTextures = null;
    this.terrainPanel?.clearCurrentMaterialTexture();
    this.saveButton.disabled = true;
    if (this.root.getAttribute('aria-busy') === 'true') {
      this.invalidatedDuringLoad = true;
      this.root.dataset.stale = 'true';
      this.textureStatus = 'Material changed during generation · refresh when ready';
      if (this.mode === 'texture') this.status.textContent = this.textureStatus;
      return;
    }
    if (this.textures === null) return;
    this.root.dataset.stale = 'true';
    this.textureStatus = 'Material changed · refresh preview';
    if (this.mode === 'texture') this.status.textContent = this.textureStatus;
    this.refreshButton.disabled = false;
  }

  public setError(message: string): void {
    this.invalidatedDuringLoad = false;
    this.root.setAttribute('aria-busy', 'false');
    this.textureStatus = 'Tile generation failed';
    if (this.mode === 'texture') this.status.textContent = this.textureStatus;
    this.empty.hidden = this.textures !== null;
    if (this.textures === null) this.empty.textContent = message;
    this.refreshButton.disabled = false;
    this.saveButton.disabled = this.textures === null || this.root.dataset.stale === 'true';
    this.terrainPanel?.setCurrentMaterialError(message);
  }

  public dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.terrainPanel?.dispose();
  }

  /**
   * The terrain lab drags in the whole terrain stack (generator, hydrology, mesh
   * preview, player controller) plus its stylesheets, none of which the material
   * workspace needs. It is fetched the first time the terrain view is actually shown.
   * The in-flight promise is cached because the ResizeObserver can ask repeatedly
   * before the import resolves.
   */
  private ensureTerrainPanel(): Promise<TerrainTileLabPanel | null> {
    if (this.terrainPanelPromise !== null) return this.terrainPanelPromise;

    this.terrainPanelPromise = import('./TerrainTileLabPanel')
      .then(({ TerrainTileLabPanel }) => {
        if (this.disposed) return null;
        const panel = new TerrainTileLabPanel(this.terrainHost, {
          onStatus: (message) => {
            this.terrainStatus = message;
            if (this.mode === 'terrain') this.status.textContent = message;
          },
          onCurrentMaterialRequested: () => this.callbacks.onTextureRequested?.()
        });
        this.terrainPanel = panel;
        if (this.currentMaterialTextures !== null) {
          panel.setCurrentMaterialTextures(this.currentMaterialTextures);
        }
        return panel;
      })
      .catch((error: unknown) => {
        this.terrainPanelPromise = null;
        console.warn('Terrain tile lab failed to load.', error);
        return null;
      });

    return this.terrainPanelPromise;
  }

  private setMode(mode: TileLabMode): void {
    this.mode = mode;
    const texture = mode === 'texture';
    this.textureActions.hidden = !texture;
    this.textureView.hidden = !texture;
    this.textureFooter.hidden = !texture;
    this.terrainHost.hidden = texture;
    this.status.textContent = texture ? this.textureStatus : this.terrainStatus;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-tile-mode]')) {
      button.classList.toggle('is-active', button.dataset.tileMode === mode);
    }
    if (texture) {
      this.render();
      this.callbacks.onTextureRequested?.();
    } else if (this.root.getBoundingClientRect().width > 0) {
      void this.ensureTerrainPanel();
    }
  }

  private updateMetrics(): void {
    if (this.textures === null) { this.metrics.textContent = 'Preview not generated'; return; }
    const channel = CHANNELS.find((entry) => entry.id === this.channel);
    const mismatch = measureEdgeMismatch(this.textures[this.channel].canvas) * 100;
    this.metrics.textContent = `${this.textures.resolution}² · seam mismatch ${mismatch.toFixed(3)}% · ${channel?.label ?? this.channel}`;
  }

  private render(): void {
    if (this.mode !== 'texture' || this.textures === null) return;
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
    context.fillStyle = '#0b0e13'; context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    const gridSize = Math.min(width, height) * 0.94;
    const tileSize = gridSize / this.tileCount;
    const startX = (width - gridSize) * 0.5;
    const startY = (height - gridSize) * 0.5;
    const source = this.textures[this.channel].canvas;
    for (let y = 0; y < this.tileCount; y += 1) {
      for (let x = 0; x < this.tileCount; x += 1) {
        context.drawImage(source, startX + x * tileSize, startY + y * tileSize, tileSize, tileSize);
      }
    }
    if (!this.showGrid) return;
    context.save(); context.strokeStyle = 'rgba(226,232,255,.38)'; context.lineWidth = Math.max(1, pixelRatio);
    for (let index = 0; index <= this.tileCount; index += 1) {
      const x = startX + index * tileSize; const y = startY + index * tileSize;
      context.beginPath(); context.moveTo(x, startY); context.lineTo(x, startY + gridSize); context.stroke();
      context.beginPath(); context.moveTo(startX, y); context.lineTo(startX + gridSize, y); context.stroke();
    }
    context.restore();
  }
}
