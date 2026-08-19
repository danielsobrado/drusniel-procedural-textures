import { UI_CONFIG } from '../app/constants';

export type RadialCommand =
  | 'add-noise'
  | 'add-cells'
  | 'add-veins'
  | 'add-wet'
  | 'add-sss'
  | 'sphere'
  | 'torus'
  | 'import'
  | 'open-project'
  | 'save-project'
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
  { command: 'add-veins', label: 'Vessels', glyph: '⌁' },
  { command: 'add-wet', label: 'Wet', glyph: '◌' },
  { command: 'add-sss', label: 'SSS', glyph: '◐' },
  { command: 'sphere', label: 'Sphere', glyph: '●' },
  { command: 'torus', label: 'Torus', glyph: '◉' },
  { command: 'import', label: 'Import', glyph: '↥' },
  { command: 'open-project', label: 'Open', glyph: '↗' },
  { command: 'save-project', label: 'Save', glyph: '↓' },
  { command: 'frame', label: 'Frame', glyph: '⌗' },
  { command: 'wireframe', label: 'Wire', glyph: '◇' }
];

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

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
    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
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
    if (focusFirst) this.focusItem(0);
  }

  public hide(): void {
    if (!this.visible) return;
    this.host.classList.remove('is-open');
    this.host.replaceChildren();
    this.visible = false;
    const previousFocus = this.previousFocus;
    this.previousFocus = null;
    previousFocus?.focus({ preventScroll: true });
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    const commandButton = target.closest<HTMLElement>('[data-radial-command]');
    const command = commandButton?.dataset.radialCommand as RadialCommand | undefined;
    if (command !== undefined) {
      this.hide();
      this.onCommand(command);
      return;
    }
    if (target.closest('[data-radial-dismiss]') !== null) this.hide();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.visible) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.focusItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.focusItem(ITEMS.length - 1);
      return;
    }
    const direction = NEXT_KEYS.has(event.key) ? 1 : PREVIOUS_KEYS.has(event.key) ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    const buttons = this.buttons();
    if (buttons.length === 0) return;
    const activeIndex = document.activeElement instanceof HTMLButtonElement
      ? buttons.indexOf(document.activeElement)
      : -1;
    const nextIndex = activeIndex < 0
      ? direction > 0 ? 0 : buttons.length - 1
      : (activeIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus({ preventScroll: true });
  }

  private focusItem(index: number): void {
    this.buttons()[index]?.focus({ preventScroll: true });
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.host.querySelectorAll<HTMLButtonElement>('[data-radial-command]'));
  }
}
