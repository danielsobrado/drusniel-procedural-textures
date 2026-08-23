import { escapeHtml } from '../utils/html';

/**
 * Reports progress of a long production operation (bake / export / tile).
 *
 * A step whose duration is genuinely unknowable - a single opaque GPU readback, say -
 * reports a `null` fraction and renders as indeterminate rather than inventing a
 * percentage. The bar should never claim to know something it does not.
 */
export class ProgressOverlay {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private readonly percent: HTMLElement;
  private active = false;

  public constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'progress-overlay';
    this.root.dataset.active = 'false';
    this.root.dataset.determinate = 'false';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="progress-panel">
        <div class="progress-title" data-role="progress-title"></div>
        <div class="progress-track"><div class="progress-fill" data-role="progress-fill"></div></div>
        <div class="progress-status">
          <span data-role="progress-label"></span>
          <span data-role="progress-percent"></span>
        </div>
      </div>
    `;
    host.append(this.root);

    this.title = this.required('progress-title');
    this.fill = this.required('progress-fill');
    this.label = this.required('progress-label');
    this.percent = this.required('progress-percent');
  }

  public begin(title: string): void {
    this.active = true;
    this.title.textContent = title;
    this.label.textContent = 'Preparing…';
    this.percent.textContent = '';
    this.fill.style.transform = 'scaleX(0)';
    this.root.dataset.determinate = 'false';
    this.root.hidden = false;
    // Force a style flush so the opacity transition runs from the hidden state.
    void this.root.offsetWidth;
    this.root.dataset.active = 'true';
  }

  /** `fraction` of `null` means this step's duration is not knowable. */
  public report(label: string, fraction: number | null): void {
    if (!this.active) return;
    this.label.textContent = label;

    if (fraction === null || !Number.isFinite(fraction)) {
      this.root.dataset.determinate = 'false';
      this.percent.textContent = '';
      return;
    }

    const clamped = Math.max(0, Math.min(1, fraction));
    this.root.dataset.determinate = 'true';
    this.fill.style.transform = `scaleX(${clamped})`;
    this.percent.textContent = `${Math.round(clamped * 100)}%`;
  }

  public finish(): void {
    if (!this.active) return;
    this.active = false;
    this.root.dataset.active = 'false';
    const hide = (): void => {
      if (!this.active) this.root.hidden = true;
    };
    if (this.prefersReducedMotion()) hide();
    else window.setTimeout(hide, 200);
  }

  public dispose(): void {
    this.active = false;
    this.root.remove();
  }

  private prefersReducedMotion(): boolean {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private required(role: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`[data-role="${escapeHtml(role)}"]`);
    if (element === null) throw new Error(`Missing progress overlay element: ${role}`);
    return element;
  }
}
