/**
 * Typed access to the boot splash installed inline by index.html.
 *
 * The splash exists before any module is fetched, so this handle may legitimately be
 * absent (a test harness, the thumbnail generator entry point, or a stale index.html).
 * Every call is therefore a no-op when the handle is missing - boot progress must never
 * be able to break boot.
 */

export type BootStage =
  | 'Loading interface'
  | 'Starting renderer'
  | 'Compiling material'
  | 'Preparing studio lighting'
  | 'Ready';

interface BootHandle {
  report(stage: string, fraction?: number): void;
  finish(): void;
}

/** Fractions are milestones on the real boot path, not a timer. */
export const BOOT_FRACTIONS: Readonly<Record<BootStage, number>> = {
  'Loading interface': 0.12,
  'Starting renderer': 0.4,
  'Compiling material': 0.62,
  'Preparing studio lighting': 0.84,
  Ready: 1
};

function handle(): BootHandle | null {
  const candidate = (globalThis as { __ptlBoot?: BootHandle }).__ptlBoot;
  return candidate !== undefined ? candidate : null;
}

export function reportBootStage(stage: BootStage): void {
  handle()?.report(stage, BOOT_FRACTIONS[stage]);
}

/** Marks boot complete and dismisses the splash. Safe to call more than once. */
export function finishBoot(): void {
  handle()?.finish();
}
