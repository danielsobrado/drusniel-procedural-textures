import { UI_CONFIG } from '../app/constants';

interface ActivePress {
  pointerId: number;
  pointerType: string;
  pointerTarget: EventTarget;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  timer: number;
  triggered: boolean;
}

export class TouchRadialTrigger {
  private active: ActivePress | null = null;
  private forwardingCancel = false;

  public constructor(private readonly target: HTMLElement) {
    target.addEventListener('pointerdown', (event) => this.handlePointerDown(event), true);
    target.addEventListener('pointermove', (event) => this.handlePointerMove(event), true);
    target.addEventListener('pointerup', (event) => this.handlePointerEnd(event), true);
    target.addEventListener('pointercancel', (event) => this.handlePointerEnd(event), true);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.target instanceof Element && event.target.closest('[data-role="surface-graph"]') !== null) return;
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    if (!event.isPrimary) {
      this.cancel();
      return;
    }

    this.cancel();
    const active: ActivePress = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      pointerTarget: event.target ?? this.target,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      timer: 0,
      triggered: false
    };

    active.timer = window.setTimeout(() => {
      if (this.active !== active) return;
      active.triggered = true;
      this.cancelViewportGesture(active);
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
    if (active === null || active.pointerId !== event.pointerId) return;

    active.clientX = event.clientX;
    active.clientY = event.clientY;
    if (active.triggered) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (distance > UI_CONFIG.longPressMoveTolerancePx) this.cancel();
  }

  private handlePointerEnd(event: PointerEvent): void {
    if (this.forwardingCancel) return;
    const active = this.active;
    if (active === null || active.pointerId !== event.pointerId) return;

    window.clearTimeout(active.timer);
    this.active = null;
    if (active.triggered) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private cancelViewportGesture(active: ActivePress): void {
    this.forwardingCancel = true;
    try {
      active.pointerTarget.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true,
        cancelable: true,
        pointerId: active.pointerId,
        pointerType: active.pointerType,
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: active.clientX,
        clientY: active.clientY
      }));
    } finally {
      this.forwardingCancel = false;
    }
  }

  private cancel(): void {
    if (this.active !== null) {
      window.clearTimeout(this.active.timer);
      this.active = null;
    }
  }
}
