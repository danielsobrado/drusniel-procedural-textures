import { UI_CONFIG } from '../app/constants';

export type RadialCommand =
  | 'add-noise'
  | 'add-cells'
  | 'add-veins'
  | 'sphere'
  | 'torus'
  | 'import'
  | 'frame'
  | 'wireframe';

interface RadialItem {
  command: RadialCommand;
  label: string;
  glyph: string;
}

const ITEMS: readonly RadialItem[] = [
  { command: 'add-noise', label: 'Noise', glyph: '≈' },
  { command: 'add-cells', label: 'Cells', glyph: '⬡' },
  { command: 'add-veins', label: 'Veins', glyph: '⌁' },
  { command: 'sphere', label: 'Sphere', glyph: '●' },
  { command: 'torus', label: 'Torus', glyph: '◉' },
  { command: 'import', label: 'Import', glyph: '↥' },
  { command: 'frame', label: 'Frame', glyph: '⌗' },
  { command: 'wireframe', label: 'Wire', glyph: '◇' }
];

function safeCenter(position: number, extent: number, margin: number): number {
  const center = extent / 2;
  const minimum = Math.min(margin, center);
  const maximum = Math.max(extent - margin, center);
  return Math.max(minimum, Math.min(maximum, position));
}

export class RadialMenu {
  private visible = false;
  private previousFocus: HTMLElement | null = null;

  public constructor(
    private readonly host: HTMLElement,
    private readonly onCommand: (command: RadialCommand) => void
  ) {
    this.host.addEventListener('click', (event) => this.handleClick(event));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.hide();
      }
    });
  }

  public open(x: number, y: number, focusFirst = false): void {
    const radius = UI_CONFIG.radialRadiusPx;
    const margin = radius + UI_CONFIG.radialEdgePaddingPx;
    const safeX = safeCenter(x, window.innerWidth, margin);
    const safeY = safeCenter(y, window.innerHeight, margin);

    this.previousFocus = focusFirst && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    this.host.innerHTML = `
      <div class="radial-backdrop" data-radial-dismiss></div>
      <div class="radial-menu" role="menu" aria-label="Quick actions" style="left:${safeX}px;top:${safeY}px">
        <div class="radial-center" aria-hidden="true">
          <strong>Quick</strong>
          <span>actions</span>
        </div>
        ${ITEMS.map((item, index) => {
          const angle = -Math.PI / 2 + (index / ITEMS.length) * Math.PI * 2;
          const px = Math.cos(angle) * radius;
          const py = Math.sin(angle) * radius;
          return `
            <button
              class="radial-item"
              data-radial-command="${item.command}"
              role="menuitem"
              aria-label="${item.label}"
              style="--radial-x:${px.toFixed(2)}px;--radial-y:${py.toFixed(2)}px"
              title="${item.label}"
            >
              <span aria-hidden="true">${item.glyph}</span>
              <small>${item.label}</small>
            </button>
          `;
        }).join('')}
      </div>
    `;

    this.host.classList.add('is-open');
    this.visible = true;

    if (focusFirst) {
      this.host.querySelector<HTMLButtonElement>('[data-radial-command]')?.focus({ preventScroll: true });
    }
  }

  public hide(): void {
    if (!this.visible) {
      return;
    }

    this.host.classList.remove('is-open');
    this.host.replaceChildren();
    this.visible = false;

    const previousFocus = this.previousFocus;
    this.previousFocus = null;
    previousFocus?.focus({ preventScroll: true });
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) {
      return;
    }

    const commandButton = target.closest<HTMLElement>('[data-radial-command]');
    const command = commandButton?.dataset.radialCommand as RadialCommand | undefined;
    if (command !== undefined) {
      this.hide();
      this.onCommand(command);
      return;
    }

    if (target.closest('[data-radial-dismiss]') !== null) {
      this.hide();
    }
  }
}
