import { UI_CONFIG } from '../app/constants';

interface LongPressState {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
}

export function installLongPressContextMenu(): () => void {
  let active: LongPressState | null = null;

  const cancel = (): void => {
    if (active !== null) {
      window.clearTimeout(active.timer);
      active = null;
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') {
      return;
    }

    if (!event.isPrimary || active !== null) {
      cancel();
      return;
    }

    const target = event.target instanceof Element ? event.target.closest('.viewport') : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;

    const timer = window.setTimeout(() => {
      if (active?.pointerId !== pointerId) {
        return;
      }

      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: startX,
        clientY: startY
      }));
      active = null;
    }, UI_CONFIG.longPressDelayMs);

    active = { pointerId, startX, startY, timer };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
    if (distance > UI_CONFIG.longPressMoveTolerancePx) {
      cancel();
    }
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (active?.pointerId === event.pointerId) {
      cancel();
    }
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerEnd, { passive: true });
  document.addEventListener('pointercancel', onPointerEnd, { passive: true });

  return () => {
    cancel();
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerEnd);
    document.removeEventListener('pointercancel', onPointerEnd);
  };
}
