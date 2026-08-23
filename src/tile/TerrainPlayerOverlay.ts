import type { TerrainPlayerState } from './TerrainPlayerController';

interface TerrainPlayerOverlayCallbacks {
  onToggle: () => void;
}

export class TerrainPlayerOverlay {
  private readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly buttonLabel: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly hudLabel: HTMLElement;

  public constructor(
    canvas: HTMLCanvasElement,
    private readonly callbacks: Readonly<TerrainPlayerOverlayCallbacks>
  ) {
    this.root = document.createElement('div');
    this.root.className = 'terrain-player-overlay';
    this.root.innerHTML = `
      <button class="terrain-player-toggle" type="button" aria-pressed="false">
        <span class="terrain-player-toggle-icon" aria-hidden="true">◎</span>
        <span data-role="terrain-player-button-label">Player mode</span>
      </button>
      <div class="terrain-player-hud" data-role="terrain-player-hud" hidden>
        <span class="terrain-player-reticle" aria-hidden="true"></span>
        <div class="terrain-player-instructions">
          <strong data-role="terrain-player-hud-label">Click terrain to spawn</strong>
          <small>WASD move · Shift sprint · mouse look · Esc releases mouse</small>
        </div>
      </div>
    `;
    canvas.insertAdjacentElement('afterend', this.root);

    const button = this.root.querySelector<HTMLButtonElement>('.terrain-player-toggle');
    const buttonLabel = this.root.querySelector<HTMLElement>('[data-role="terrain-player-button-label"]');
    const hud = this.root.querySelector<HTMLElement>('[data-role="terrain-player-hud"]');
    const hudLabel = this.root.querySelector<HTMLElement>('[data-role="terrain-player-hud-label"]');
    if (button === null || buttonLabel === null || hud === null || hudLabel === null) {
      this.root.remove();
      throw new Error('Terrain player overlay could not be initialized.');
    }
    this.button = button;
    this.buttonLabel = buttonLabel;
    this.hud = hud;
    this.hudLabel = hudLabel;
    this.button.addEventListener('click', () => this.callbacks.onToggle());
    this.setState('idle');
  }

  public setState(state: TerrainPlayerState): void {
    const active = state !== 'idle';
    this.root.dataset.state = state;
    this.button.classList.toggle('is-active', active);
    this.button.setAttribute('aria-pressed', String(active));
    this.buttonLabel.textContent = state === 'idle'
      ? 'Player mode'
      : state === 'placing'
        ? 'Cancel player'
        : 'Exit player';
    this.hud.hidden = state === 'idle';
    if (state === 'placing') this.hudLabel.textContent = 'Click terrain to spawn';
    else if (state === 'playing') this.hudLabel.textContent = 'Walking seamless terrain';
    else if (state === 'paused') this.hudLabel.textContent = 'Click the view to resume';
  }

  public setStatus(message: string): void {
    if (this.hud.hidden) return;
    this.hudLabel.textContent = message;
  }

  public dispose(): void {
    this.root.remove();
  }
}
