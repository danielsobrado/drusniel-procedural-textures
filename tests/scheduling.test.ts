import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameBudget } from '../src/core/scheduling/FrameBudget';
import { scheduleIdleTask } from '../src/utils/scheduling';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('idle task scheduling', () => {
  it('cancels the timeout fallback before it can run', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const task = vi.fn();

    const cancel = scheduleIdleTask(task);
    cancel();
    vi.runAllTimers();

    expect(task).not.toHaveBeenCalled();
  });

  it('cancels a native idle callback before it can run', () => {
    let callback: (() => void) | null = null;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal('requestIdleCallback', vi.fn((next: () => void) => {
      callback = next;
      return 17;
    }));
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);
    const task = vi.fn();

    const cancel = scheduleIdleTask(task);
    cancel();
    (callback as (() => void) | null)?.();

    expect(cancelIdleCallback).toHaveBeenCalledWith(17);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('frame-budget scheduling', () => {
  it('yields only after its work deadline and starts a fresh budget afterward', async () => {
    let now = 10;
    const yieldTask = vi.fn(async () => undefined);
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('scheduler', { yield: yieldTask });
    const budget = createFrameBudget(5);

    expect(budget.isDue()).toBe(false);
    await budget.yieldIfDue();
    now = 15;
    expect(budget.isDue()).toBe(true);
    await budget.yieldIfDue();
    now = 19;
    expect(budget.isDue()).toBe(false);
    await budget.yieldIfDue();
    now = 20;
    expect(budget.isDue()).toBe(true);
    await budget.yieldIfDue();

    expect(yieldTask).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid %s ms budget', (budgetMs) => {
    expect(() => createFrameBudget(budgetMs)).toThrow('Frame budget must be a positive number of milliseconds.');
  });
});
