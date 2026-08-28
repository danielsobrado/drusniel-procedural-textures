import { UI_CONFIG } from '../app/constants';
import { createFrameBudget as createBudget, type FrameBudget } from '../core/scheduling/FrameBudget';

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

/**
 * Schedules disposable background work. The returned cancellation function is idempotent and
 * prevents the task from running even if a browser invokes an already-cancelled idle callback.
 */
export function scheduleIdleTask(task: () => void): () => void {
  let active = true;
  const run = (): void => {
    if (!active) return;
    active = false;
    task();
  };

  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(run, { timeout: UI_CONFIG.idleWorkTimeoutMs });
    return () => {
      if (!active) return;
      active = false;
      globalThis.cancelIdleCallback(handle);
    };
  }

  const handle = globalThis.setTimeout(run, 0);
  return () => {
    if (!active) return;
    active = false;
    globalThis.clearTimeout(handle);
  };
}

/**
 * Re-exported from src/core so the runtime package (which cannot reach app configuration)
 * shares one implementation. Lab callers get the configured budget by default.
 */
export { yieldToMainThread, type FrameBudget } from '../core/scheduling/FrameBudget';

export function createFrameBudget(budgetMs = UI_CONFIG.frameBudgetMs): FrameBudget {
  return createBudget(budgetMs);
}
