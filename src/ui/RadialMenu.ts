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

export class RadialMenu {
  private visible = false;

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

  public open(x: number, y: number): void {
    const radius = 104;
    const margin = radius + 58;
    const safeX = Math.max(margin, Math.min(window.innerWidth - margin, x));
    const safeY = Math.max(margin, Math.min(window.innerHeight - margin, y));

    this.host.innerHTML = `
      <div class="radial-backdrop" data-radial-dismiss></div>
      <div class="radial-menu" style="left:${safeX}px;top:${safeY}px">
        <div class="radial-center">
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
              style="--radial-x:${px.toFixed(2)}px;--radial-y:${py.toFixed(2)}px"
              title="${item.label}"
            >
              <span>${item.glyph}</span>
              <small>${item.label}</small>
            </button>
          `;
        }).join('')}
      </div>
    `;

    this.host.classList.add('is-open');
    this.visible = true;
  }

  public hide(): void {
    if (!this.visible) {
      return;
    }

    this.host.classList.remove('is-open');
    this.host.replaceChildren();
    this.visible = false;
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
