/**
 * Playwright smoke test for Tile Lab right-side material preset assignment.
 *
 * Tests:
 * 1. Opening Tile Lab ("Tiles" button in toolbar).
 * 2. Waiting for initial terrain generation.
 * 3. Changing the material preset dropdowns on the right panel for:
 *    - grass
 *    - rock
 *    - mud
 *    - snow
 * 4. Testing multiple presets including biological/synthesis presets (with compute/simulation).
 * 5. Testing rapid switching and restoring to built-in.
 * 6. Verifying slot never remains stuck in "is-loading" and no fatal errors occur.
 */
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4176;
const APP_URL = `http://${HOST}:${PORT}/`;
const START_TIMEOUT_MS = 30_000;
const BAKE_TIMEOUT_MS = 20_000;
const FATAL_CONSOLE_PATTERN = /shader error|validate_status false|error:\s*0:|webglprogram.*error|webgpu.*(?:error|validation)|uncaught|unhandled/i;

function terminate(child) {
  if (child === null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // Fallback
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
      // Still starting
    }
    await delay(200);
  }
  throw new Error('Timed out waiting for Vite dev server.');
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const devServer = startDev(root);
  let browser = null;

  try {
    await waitForServer();
    console.log('Dev server ready.');

    browser = await chromium.launch({ headless: true, timeout: START_TIMEOUT_MS });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(START_TIMEOUT_MS);

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
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell').waitFor({ state: 'attached' });
    await page.locator('canvas.lab-canvas').waitFor({ state: 'visible' });
    console.log('Main editor canvas ready.');

    // Click "Tiles" button in toolbar to open Tile Lab
    const tilesBtn = page.locator('[data-command="tile-preview"]');
    await tilesBtn.waitFor({ state: 'visible' });
    await tilesBtn.click();
    console.log('Opened Tile Lab.');

    // Wait for Tile Lab host to become active
    await page.locator('.app-shell.is-tile-mode').waitFor({ state: 'attached' });
    const mapCanvas = page.locator('[data-role="terrain-map"]');
    await mapCanvas.waitFor({ state: 'visible' });

    // Wait for initial terrain generation to finish
    await page.waitForFunction(
      () => !document.querySelector('[data-role="terrain-status"]')?.textContent?.includes('… %')
    );
    console.log('Terrain initial generation complete.');

    // Find the material slots on the right panel
    const materialsToTest = ['grass', 'rock', 'mud', 'snow'];
    for (const mat of materialsToTest) {
      const select = page.locator(`[data-material-preset="${mat}"]`);
      await select.waitFor({ state: 'visible' });
      const options = await select.evaluate((el) =>
        Array.from(el.options).map((o) => ({ value: o.value, text: o.text })).filter((o) => o.value !== '')
      );
      console.log(`Found ${options.length} presets for ${mat}.`);
    }

    // Test a variety of presets for each material slot
    const testCases = [
      { material: 'grass', presetIndex: 0 },
      { material: 'grass', presetIndex: 5 },
      { material: 'rock', presetIndex: 2 },
      { material: 'rock', presetIndex: 7 },
      { material: 'mud', presetIndex: 3 },
      { material: 'mud', presetIndex: 8 },
      { material: 'snow', presetIndex: 1 },
      { material: 'snow', presetIndex: 6 },
    ];

    for (const { material, presetIndex } of testCases) {
      const select = page.locator(`[data-material-preset="${material}"]`);
      const slot = page.locator(`[data-material-slot="${material}"]`);

      const optionValue = await select.evaluate((el, idx) => {
        const validOptions = Array.from(el.options).filter((o) => o.value !== '');
        return validOptions[idx % validOptions.length]?.value;
      }, presetIndex);

      const optionText = await select.evaluate((el, val) => {
        return Array.from(el.options).find((o) => o.value === val)?.text;
      }, optionValue);

      console.log(`Testing ${material} -> "${optionText}" (${optionValue})...`);

      const startTime = Date.now();
      await select.selectOption(optionValue);

      // Wait for baking to complete (slot drops is-loading and select is not disabled)
      try {
        await page.waitForFunction(
          (mat) => {
            const s = document.querySelector(`[data-material-slot="${mat}"]`);
            const sel = document.querySelector(`[data-material-preset="${mat}"]`);
            return s && !s.classList.contains('is-loading') && sel && !sel.disabled;
          },
          material,
          { timeout: BAKE_TIMEOUT_MS }
        );
        const elapsed = Date.now() - startTime;
        console.log(`  ✓ ${material} baked "${optionText}" in ${elapsed} ms`);
      } catch {
        console.error(`  ✗ ${material} STUCK baking "${optionText}" after ${BAKE_TIMEOUT_MS} ms`);
        failures.push(`Tile Lab ${material} slot stuck baking "${optionText}"`);
      }
    }

    // Test rapid consecutive preset changes on the same slot
    console.log('\nTesting rapid material changes on "grass" slot...');
    const grassSelect = page.locator('[data-material-preset="grass"]');
    const rapidOptions = await grassSelect.evaluate((el) =>
      Array.from(el.options).slice(1, 5).map((o) => o.value)
    );

    for (const val of rapidOptions) {
      await grassSelect.selectOption(val);
      await delay(50); // fast trigger before bake completes
    }

    // Wait for the final bake to settle
    try {
      await page.waitForFunction(
        () => {
          const s = document.querySelector('[data-material-slot="grass"]');
          const sel = document.querySelector('[data-material-preset="grass"]');
          return s && !s.classList.contains('is-loading') && sel && !sel.disabled;
        },
        { timeout: BAKE_TIMEOUT_MS }
      );
      console.log('  ✓ Rapid changes on grass slot resolved cleanly.');
    } catch {
      console.error('  ✗ Rapid changes caused grass slot to freeze!');
      failures.push('Rapid material changes in Tile Lab caused slot to freeze.');
    }

    // Test resetting back to "Built-in" (value = "")
    console.log('\nTesting reset to Built-in for all slots...');
    for (const mat of materialsToTest) {
      const select = page.locator(`[data-material-preset="${mat}"]`);
      await select.selectOption('');
      await page.waitForFunction(
        (m) => {
          const s = document.querySelector(`[data-material-slot="${m}"]`);
          const label = document.querySelector(`[data-material-source="${m}"]`);
          return s && !s.classList.contains('is-loading') && label?.textContent === 'Built-in procedural';
        },
        mat,
        { timeout: 5000 }
      );
      console.log(`  ✓ ${mat} reset to built-in procedural.`);
    }

    await context.close();

    if (failures.length > 0) {
      throw new Error(
        `Tile Lab Material Smoke FAILED with ${failures.length} issue(s):\n` +
        [...new Set(failures)].map((f) => `  • ${f}`).join('\n')
      );
    }

    console.log('\nTile Lab Material Smoke PASSED successfully!');
  } finally {
    await browser?.close();
    terminate(devServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
