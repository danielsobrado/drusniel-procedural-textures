import { APP_NAME, PERFORMANCE_CONFIG, UI_CONFIG } from '../app/constants';
import type { PerformanceStats, QualityTier } from '../engine/Quality';
import { escapeHtml } from '../utils/html';

export interface ShellElements {
  viewport: HTMLElement;
  library: HTMLElement;
  inspector: HTMLElement;
  layers: HTMLElement;
  radial: HTMLElement;
  modelInput: HTMLInputElement;
  projectInput: HTMLInputElement;
  environmentInput: HTMLInputElement;
  qualitySelect: HTMLSelectElement;
  performance: HTMLElement;
  objectLabel: HTMLElement;
  status: HTMLElement;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required UI element: ${selector}`);
  }
  return element;
}

function qualityOptions(): string {
  const fixed = Object.entries(PERFORMANCE_CONFIG.tiers).map(([id, settings]) => `
    <option value="${escapeHtml(id)}">${escapeHtml(settings.label)}</option>
  `).join('');
  return `<option value="auto">Auto</option>${fixed}`;
}

function formatTriangles(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function isQualityTier(value: string): value is QualityTier {
  return value === 'auto' || Object.prototype.hasOwnProperty.call(PERFORMANCE_CONFIG.tiers, value);
}

export class Shell {
  public readonly elements: ShellElements;

  private readonly root: HTMLElement;
  private readonly toastElement: HTMLElement;
  private toastTimer: number | null = null;

  public constructor(root: HTMLElement) {
    this.root = root;
    const appName = escapeHtml(APP_NAME);

    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand" title="${appName}">
            <span class="brand-mark" aria-hidden="true">PTL</span>
            <div class="brand-copy">
              <strong>${appName}</strong>
              <span>Realtime material authoring</span>
            </div>
          </div>

          <div class="toolbar-group toolbar-project" aria-label="Project and export commands">
            <button class="icon-button" data-command="undo" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">↶</button>
            <button class="icon-button" data-command="redo" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
            <span class="toolbar-divider" aria-hidden="true"></span>
            <button class="compact-button" data-command="import-model">Import mesh</button>
            <button class="compact-button" data-command="open-project">Open</button>
            <button class="compact-button" data-command="save-project">Save</button>
            <button class="compact-button" data-command="export-material" title="Export a portable runtime material recipe">Export PTL</button>
            <span class="toolbar-divider phase3-divider" aria-hidden="true"></span>
            <button class="compact-button phase3-command" data-command="bake-textures" title="Bake PBR texture maps">Bake maps</button>
            <button class="compact-button phase3-command" data-command="export-glb" title="Bake material and export binary glTF">Export GLB</button>
          </div>

          <div class="toolbar-group toolbar-view" aria-label="Viewport commands">
            <span class="status-pill" data-role="status">Physical · WebGL</span>
            <label class="quality-control" title="Viewport, bake and export quality tier">
              <span aria-hidden="true">Q</span>
              <select data-role="quality-select" aria-label="Quality tier">
                ${qualityOptions()}
              </select>
            </label>
            <button class="icon-button" data-command="frame" aria-label="Frame selection" title="Frame selection (F)">⌗</button>
            <button class="icon-button" data-command="wireframe" aria-label="Toggle wireframe" title="Toggle wireframe (W)">◇</button>
            <button class="icon-button" data-command="snapshot" aria-label="Save preview PNG" title="Save PNG">◫</button>
          </div>
        </header>

        <aside class="panel library-panel" data-role="library"></aside>

        <main class="viewport" data-role="viewport">
          <div class="viewport-badge">
            <span class="live-dot" aria-hidden="true"></span>
            <span data-role="object-label">Sphere</span>
          </div>
          <div class="viewport-help">Right click / Space · radial menu</div>
          <div class="performance-hud" data-role="performance">Profiling…</div>
          <div class="drop-overlay">Drop GLB / GLTF bundle</div>
        </main>

        <aside class="panel inspector-panel" data-role="inspector"></aside>
        <section class="layer-dock" data-role="layers"></section>
        <div class="radial-host" data-role="radial"></div>
        <div class="toast" data-role="toast" aria-live="polite"></div>

        <input
          class="visually-hidden"
          data-role="model-input"
          type="file"
          multiple
          accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,model/gltf-binary,model/gltf+json,image/*,application/octet-stream"
        >
        <input class="visually-hidden" data-role="project-input" type="file" accept=".json,application/json">
        <input class="visually-hidden" data-role="environment-input" type="file" accept=".hdr,image/vnd.radiance">
      </div>
    `;

    this.elements = {
      viewport: required(this.root, '[data-role="viewport"]'),
      library: required(this.root, '[data-role="library"]'),
      inspector: required(this.root, '[data-role="inspector"]'),
      layers: required(this.root, '[data-role="layers"]'),
      radial: required(this.root, '[data-role="radial"]'),
      modelInput: required(this.root, '[data-role="model-input"]'),
      projectInput: required(this.root, '[data-role="project-input"]'),
      environmentInput: required(this.root, '[data-role="environment-input"]'),
      qualitySelect: required(this.root, '[data-role="quality-select"]'),
      performance: required(this.root, '[data-role="performance"]'),
      objectLabel: required(this.root, '[data-role="object-label"]'),
      status: required(this.root, '[data-role="status"]')
    };
    this.elements.qualitySelect.value = PERFORMANCE_CONFIG.defaultTier;

    this.toastElement = required(this.root, '[data-role="toast"]');
  }

  public onCommand(command: string, callback: () => void): void {
    const button = this.root.querySelector<HTMLElement>(`[data-command="${command}"]`);
    if (button === null) {
      throw new Error(`Unknown shell command: ${command}`);
    }
    button.addEventListener('click', callback);
  }

  public onQualityChange(callback: (tier: QualityTier) => void): void {
    this.elements.qualitySelect.addEventListener('change', () => {
      const value = this.elements.qualitySelect.value;
      if (!isQualityTier(value)) {
        this.elements.qualitySelect.value = PERFORMANCE_CONFIG.defaultTier;
        return;
      }
      callback(value);
    });
  }

  public setQualityTier(tier: QualityTier): void {
    this.elements.qualitySelect.value = tier;
  }

  public setPerformanceStats(stats: PerformanceStats): void {
    const quality = PERFORMANCE_CONFIG.tiers[stats.activeTier];
    const auto = stats.requestedTier === 'auto' ? ' · Auto' : '';
    this.elements.performance.textContent = [
      `${Math.round(stats.fps)} FPS`,
      `${stats.frameMs.toFixed(1)} ms`,
      `${stats.drawCalls} calls`,
      `${formatTriangles(stats.triangles)} tris`,
      `${quality.label}${auto}`
    ].join(' · ');
    this.elements.performance.title = [
      `Geometries: ${stats.geometries}`,
      `Textures: ${stats.textures}`,
      `Active quality: ${quality.label}`
    ].join('\n');
  }

  public setObjectLabel(label: string): void {
    this.elements.objectLabel.textContent = label;
  }

  public setStatus(status: string): void {
    this.elements.status.textContent = status;
  }

  public setDragging(active: boolean): void {
    this.elements.viewport.classList.toggle('is-dragging', active);
  }

  public toast(message: string, kind: 'info' | 'error' = 'info'): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastElement.textContent = message;
    this.toastElement.dataset.kind = kind;
    this.toastElement.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.toastElement.classList.remove('is-visible');
      this.toastTimer = null;
    }, kind === 'error' ? UI_CONFIG.toastErrorMs : UI_CONFIG.toastInfoMs);
  }
}
