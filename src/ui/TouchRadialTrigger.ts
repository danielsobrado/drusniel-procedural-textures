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

export interface TouchRadialPosition {
  clientX: number;
  clientY: number;
  target: EventTarget;
}

export interface TouchRadialTriggerOptions {
  onTrigger?: (position: Readonly<TouchRadialPosition>) => void;
}

export class TouchRadialTrigger {
  private active: ActivePress | null = null;
  private forwardingCancel = false;

  public constructor(
    private readonly target: HTMLElement,
    private readonly options: Readonly<TouchRadialTriggerOptions> = {}
  ) {
    target.addEventListener('pointerdown', this.onPointerDown, true);
    target.addEventListener('pointermove', this.onPointerMove, true);
    target.addEventListener('pointerup', this.onPointerEnd, true);
    target.addEventListener('pointercancel', this.onPointerEnd, true);
  }

  public dispose(): void {
    this.cancel();
    this.target.removeEventListener('pointerdown', this.onPointerDown, true);
    this.target.removeEventListener('pointermove', this.onPointerMove, true);
    this.target.removeEventListener('pointerup', this.onPointerEnd, true);
    this.target.removeEventListener('pointercancel', this.onPointerEnd, true);
  }

  private readonly onPointerDown = (event: PointerEvent): void => this.handlePointerDown(event);
  private readonly onPointerMove = (event: PointerEvent): void => this.handlePointerMove(event);
  private readonly onPointerEnd = (event: PointerEvent): void => this.handlePointerEnd(event);

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
      if (this.options.onTrigger !== undefined) {
        this.options.onTrigger({
          clientX: active.clientX,
          clientY: active.clientY,
          target: active.pointerTarget
        });
        return;
      }
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
