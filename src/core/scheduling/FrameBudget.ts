interface SchedulerWithYield {
  yield?: () => Promise<void>;
}

/**
 * setTimeout(0) is clamped to 4ms once timer nesting passes five levels, and every long CPU
 * pass in this app yields from inside a previous timer callback - so it hits the clamp
 * immediately. A 2048 normal rebuild yielded 128 times: half a second of pure sleeping.
 * `scheduler.yield()` and a message-channel task have no such clamp.
 *
 * This module stays free of app configuration so the runtime package can share it; see
 * src/utils/scheduling.ts for the Lab-side wrapper that binds the configured budget.
 */
const yieldChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null;

export function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();

  const channel = yieldChannel;
  if (channel === null) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const done = (): void => {
      channel.port1.removeEventListener('message', done);
      resolve();
    };
    channel.port1.addEventListener('message', done);
    channel.port1.start();
    channel.port2.postMessage(null);
  });
}

export interface FrameBudget {
  /** Cheap synchronous guard for hot loops that should avoid a no-op await. */
  isDue(): boolean;
  /** Yields only once the budget since the last yield has been spent. */
  yieldIfDue(): Promise<void>;
}

/**
 * Bounds how long a chunked CPU pass may hold the main thread, measured in milliseconds of
 * real work rather than a fixed row or pixel count. A count tuned for one resolution either
 * yields far too often on a fast machine - where the yields cost more than the work they
 * break up - or not often enough on a slow one. Responsiveness is unchanged either way;
 * only the number of yields moves.
 */
export function createFrameBudget(budgetMs: number): FrameBudget {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('Frame budget must be a positive number of milliseconds.');
  }
  let deadline = performance.now() + budgetMs;
  return {
    isDue(): boolean {
      return performance.now() >= deadline;
    },
    async yieldIfDue(): Promise<void> {
      if (performance.now() < deadline) return;
      await yieldToMainThread();
      deadline = performance.now() + budgetMs;
    }
  };
}
