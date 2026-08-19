import { APP_NAME, UI_CONFIG } from '../app/constants';
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

          <div class="toolbar-group toolbar-project" aria-label="Project commands">
            <button class="icon-button" data-command="undo" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">↶</button>
            <button class="icon-button" data-command="redo" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
            <span class="toolbar-divider" aria-hidden="true"></span>
            <button class="compact-button" data-command="import-model">Import mesh</button>
            <button class="compact-button" data-command="open-project">Open</button>
            <button class="compact-button" data-command="save-project">Save</button>
          </div>

          <div class="toolbar-group toolbar-view" aria-label="Viewport commands">
            <span class="status-pill" data-role="status">Physical · WebGL</span>
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
          accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.basis,model/gltf-binary,model/gltf+json,image/*,application/octet-stream"
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
      objectLabel: required(this.root, '[data-role="object-label"]'),
      status: required(this.root, '[data-role="status"]')
    };

    this.toastElement = required(this.root, '[data-role="toast"]');
  }

  public onCommand(command: string, callback: () => void): void {
    const button = this.root.querySelector<HTMLElement>(`[data-command="${command}"]`);
    if (button === null) {
      throw new Error(`Unknown shell command: ${command}`);
    }
    button.addEventListener('click', callback);
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
