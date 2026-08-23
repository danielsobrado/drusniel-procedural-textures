import { UI_CONFIG } from '../app/constants';

/** Resolves after the browser has had a chance to paint. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

/**
 * Resolves when the main thread is idle, falling back to a macrotask where
 * `requestIdleCallback` is unavailable (Safari).
 */
export function idleTurn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: UI_CONFIG.idleWorkTimeoutMs });
      return;
    }
    window.setTimeout(resolve, 0);
  });
}
