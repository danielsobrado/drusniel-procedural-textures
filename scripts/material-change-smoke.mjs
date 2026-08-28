/**
 * Playwright smoke test for the material-change freeze fix.
 *
 * Launches Vite dev server, opens the app in Chromium, and rapidly clicks
 * through every material preset in the library. The test verifies that:
 *
 *   1. The viewport never gets stuck on "Preparing material…" for longer than
 *      a generous timeout (each preset must finish compilation within 15 s).
 *   2. No uncaught exceptions or fatal shader errors appear in the console.
 *   3. After cycling through presets, the canvas is still alive and rendering.
 *
 * Run:  node scripts/material-change-smoke.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4175;
const APP_URL = `http://${HOST}:${PORT}/`;
const START_TIMEOUT_MS = 30_000;
const PRESET_COMPILE_TIMEOUT_MS = 15_000;
const FATAL_CONSOLE_PATTERN = /shader error|validate_status false|error:\s*0:|webglprogram.*error|webgpu.*(?:error|validation)|uncaught|unhandled/i;

function terminate(child) {
  if (child === null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // Fallback to standard kill
    }
  }
  child.kill('SIGTERM');
}

function startDev(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [
    vite, '--host', HOST, '--port', String(PORT), '--strictPort'
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(200);
  }
  throw new Error('Timed out waiting for the Vite dev server.');
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const devServer = startDev(root);
  let browser = null;

  try {
    await waitForServer();
    console.log('Vite dev server is ready.');

    browser = await chromium.launch({ headless: true, timeout: START_TIMEOUT_MS });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(START_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(START_TIMEOUT_MS);

    // Collect failures
    const failures = [];
    page.on('pageerror', (error) => {
      console.error(`[Page Error] ${error.message}`);
      failures.push(error.message);
    });
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && FATAL_CONSOLE_PATTERN.test(text)) {
        console.error(`[Console Error] ${text}`);
        failures.push(text);
      }
      if (message.type() === 'warning' && text.includes('compilation retry limit')) {
        console.warn(`[Retry Limit Warning] ${text}`);
      }
    });

    // Navigate and wait for the app canvas
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    console.log('Page loaded, waiting for app...');

    await page.locator('.app-shell').waitFor({ state: 'attached', timeout: START_TIMEOUT_MS });
    const canvas = page.locator('canvas.lab-canvas');
    await canvas.waitFor({ state: 'visible', timeout: START_TIMEOUT_MS });
    console.log('App canvas is visible.');

    // Wait for initial material compilation to finish
    const viewport = page.locator('[data-role="viewport"]');
    await viewport.waitFor({ state: 'attached' });

    // Give the initial material time to compile
    await page.waitForFunction(
      () => !document.querySelector('[data-role="viewport"]')?.classList.contains('is-loading'),
      { timeout: PRESET_COMPILE_TIMEOUT_MS }
    ).catch(() => {
      console.warn('Initial material is still compiling, proceeding anyway...');
    });
    console.log('Initial material ready.');

    // Collect all preset IDs from the library panel
    const presetIds = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-preset]');
      return Array.from(cards).map((card) => card.getAttribute('data-preset')).filter(Boolean);
    });
    console.log(`Found ${presetIds.length} material presets to test.`);

    if (presetIds.length === 0) {
      throw new Error('No material presets found in the library. The library panel may not have rendered.');
    }

    // Click through each preset and verify the viewport doesn't get stuck
    let passed = 0;
    let stuckCount = 0;

    for (const presetId of presetIds) {
      const presetCard = page.locator(`[data-preset="${presetId}"]`);

      // Scroll into view and click
      await presetCard.scrollIntoViewIfNeeded();
      await presetCard.click();

      // Wait for "is-loading" to appear (compilation starts) then disappear (compilation finishes).
      // If compilation finishes fast enough that we miss it appearing, that's fine too.
      const startTime = Date.now();

      try {
        // Wait for compilation to finish — the viewport should drop the is-loading class
        await page.waitForFunction(
          () => !document.querySelector('[data-role="viewport"]')?.classList.contains('is-loading'),
          { timeout: PRESET_COMPILE_TIMEOUT_MS }
        );
        const elapsed = Date.now() - startTime;
        passed += 1;
        if (passed % 5 === 0 || elapsed > 3000) {
          console.log(`  ✓ Preset "${presetId}" compiled in ${elapsed} ms (${passed}/${presetIds.length})`);
        }
      } catch {
        stuckCount += 1;
        console.error(`  ✗ Preset "${presetId}" STUCK — viewport still loading after ${PRESET_COMPILE_TIMEOUT_MS} ms`);
        failures.push(`Preset "${presetId}" stuck on "Preparing material…" for >${PRESET_COMPILE_TIMEOUT_MS} ms`);

        // Try to recover by reloading for remaining tests
        if (stuckCount >= 3) {
          console.error('Too many stuck presets. Aborting remaining preset tests.');
          break;
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await canvas.waitFor({ state: 'visible', timeout: START_TIMEOUT_MS });
        await page.waitForFunction(
          () => !document.querySelector('[data-role="viewport"]')?.classList.contains('is-loading'),
          { timeout: PRESET_COMPILE_TIMEOUT_MS }
        ).catch(() => {});
      }
    }

    // After cycling presets, verify the canvas is still alive
    const canvasAlive = await canvas.evaluate((el) => {
      return el instanceof HTMLCanvasElement && el.width > 0 && el.height > 0;
    });
    if (!canvasAlive) {
      failures.push('Canvas is not alive after preset cycling.');
    }

    // Rapid-fire test: click 5 presets in quick succession without waiting
    console.log('\nRapid-fire preset switching test...');
    const rapidPresets = presetIds.slice(0, Math.min(5, presetIds.length));
    for (const presetId of rapidPresets) {
      const card = page.locator(`[data-preset="${presetId}"]`);
      await card.scrollIntoViewIfNeeded();
      await card.click();
      await delay(100); // Only a tiny pause between clicks
    }

    // After rapid switching, the final material should still compile
    try {
      await page.waitForFunction(
        () => !document.querySelector('[data-role="viewport"]')?.classList.contains('is-loading'),
        { timeout: PRESET_COMPILE_TIMEOUT_MS }
      );
      console.log('  ✓ Rapid-fire switching recovered successfully.');
    } catch {
      console.error('  ✗ Rapid-fire switching caused a freeze!');
      failures.push('Rapid-fire preset switching caused the viewport to freeze.');
    }

    // Final verdict
    console.log('');
    await context.close();

    if (failures.length > 0) {
      throw new Error(
        `Material change smoke test FAILED with ${failures.length} issue(s):\n` +
        [...new Set(failures)].map((f) => `  • ${f}`).join('\n')
      );
    }

    console.log(`Material change smoke test PASSED — ${passed}/${presetIds.length} presets compiled, rapid-fire switching OK.`);
  } finally {
    await browser?.close();
    terminate(devServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
