import { UI_CONFIG } from '../app/constants';

interface ActivePress {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  timer: number;
  triggered: boolean;
}

export class TouchRadialTrigger {
  private active: ActivePress | null = null;

  public constructor(private readonly target: HTMLElement) {
    target.addEventListener('pointerdown', (event) => this.handlePointerDown(event), true);
    target.addEventListener('pointermove', (event) => this.handlePointerMove(event), true);
    target.addEventListener('pointerup', (event) => this.handlePointerEnd(event), true);
    target.addEventListener('pointercancel', (event) => this.handlePointerEnd(event), true);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || event.button !== 0) {
      return;
    }

    this.cancel();
    const active: ActivePress = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      timer: 0,
      triggered: false
    };

    active.timer = window.setTimeout(() => {
      if (this.active !== active) {
        return;
      }
      active.triggered = true;
      this.target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: active.clientX,
        clientY: active.clientY,
        button: 0
      }));
    }, UI_CONFIG.longPressDelayMs);

    this.active = active;
  }

  private handlePointerMove(event: PointerEvent): void {
    const active = this.active;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }

    active.clientX = event.clientX;
    active.clientY = event.clientY;
    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (!active.triggered && distance > UI_CONFIG.longPressMoveTolerancePx) {
      this.cancel();
    }
  }

  private handlePointerEnd(event: PointerEvent): void {
    const active = this.active;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }

    window.clearTimeout(active.timer);
    this.active = null;
  }

  private cancel(): void {
    if (this.active !== null) {
      window.clearTimeout(this.active.timer);
      this.active = null;
    }
  }
}
