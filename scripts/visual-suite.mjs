import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4188;
const APP_URL = `http://${HOST}:${PORT}/`;
const START_TIMEOUT_MS = 30_000;
const UI_TIMEOUT_MS = 60_000;
const OUTPUT_DIR = 'artifacts/visual-suite';

function startPreview(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}

async function waitForPreview() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await delay(150);
  }
  throw new Error('Timed out waiting for preview server.');
}

async function required(locator, label) {
  if (await locator.count() === 0) throw new Error(`Visual suite could not find ${label}.`);
  return locator.first();
}

async function waitForViewportReady(page) {
  await page.locator('canvas.lab-canvas').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.locator('[data-role="viewport"]:not(.is-loading)').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function saveScreenshot(page, outputDir, fileName) {
  const path = resolve(outputDir, fileName);
  await page.screenshot({ path, fullPage: true });
  console.log(`   Saved ${path}`);
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const outputDir = resolve(root, OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });

  const preview = startPreview(root);
  let browser = null;
  let context = null;
  try {
    await waitForPreview();

    browser = await chromium.launch({
      headless: true,
      timeout: UI_TIMEOUT_MS,
      args: ['--enable-webgl', '--ignore-gpu-blocklist']
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 1,
      acceptDownloads: true
    });

    const page = await context.newPage();
    page.setDefaultTimeout(UI_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(UI_TIMEOUT_MS);
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|uncaught|error:/i.test(message.text())) {
        failures.push(message.text());
      }
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForViewportReady(page);

    console.log('1. Testing Storm Marble on Rounded...');
    await (await required(page.locator('[data-preset="storm-marble"]'), 'Storm Marble preset')).click();
    await (await required(page.locator('[data-object="rounded-cube"]'), 'Rounded preview object')).click();
    await waitForViewportReady(page);
    await saveScreenshot(page, outputDir, 'storm-marble-rounded.png');

    console.log('2. Testing Alien Dermis on Cube...');
    await (await required(page.locator('[data-preset="alien-dermis"]'), 'Alien Dermis preset')).click();
    await (await required(page.locator('[data-object="cube"]'), 'Cube preview object')).click();
    await waitForViewportReady(page);
    await saveScreenshot(page, outputDir, 'alien-dermis-cube.png');

    console.log('3. Testing rapid preset switching during shader warmup...');
    const presetButtons = page.locator('button.preset-card');
    const presetCount = await presetButtons.count();
    if (presetCount < 2) throw new Error('Visual suite requires at least two material presets.');
    for (let index = 0; index < Math.min(presetCount, 6); index += 1) {
      await presetButtons.nth(index).click();
      await delay(50);
    }
    await presetButtons.first().click();
    await waitForViewportReady(page);
    console.log('   Rapid switching settled without a stale compile.');

    console.log('4. Testing PNG capture immediately after material change...');
    await presetButtons.nth(1).click();
    const snapshotButton = await required(page.locator('[data-command="snapshot"]'), 'snapshot command');
    const downloadPromise = page.waitForEvent('download', { timeout: UI_TIMEOUT_MS });
    await snapshotButton.click();
    const download = await downloadPromise;
    if (download.suggestedFilename() !== 'procedural-texture-preview.png') {
      throw new Error(`Unexpected snapshot filename: ${download.suggestedFilename()}`);
    }
    console.log('   Snapshot download completed after material readiness.');

    console.log('5. Testing Tile Lab repetition and seam preview...');
    await (await required(page.locator('[data-command="tile-preview"]'), 'Tile Lab command')).click();
    await page.locator('.app-shell.is-tile-mode').waitFor({ state: 'visible' });
    const tilePanel = page.locator('[data-role="tile-preview"]');
    await tilePanel.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-role="tile-preview"]');
      return panel?.getAttribute('aria-busy') === 'false';
    }, undefined, { timeout: UI_TIMEOUT_MS });
    const tileCanvas = tilePanel.locator('[data-role="tile-canvas"]');
    const tileBounds = await tileCanvas.boundingBox();
    if (tileBounds === null || tileBounds.width < 1 || tileBounds.height < 1) {
      throw new Error('Tile Lab did not produce a visible repeated-tile canvas.');
    }
    await saveScreenshot(page, outputDir, 'tile-lab-repetition.png');

    if (failures.length > 0) {
      throw new Error(`Visual suite runtime failures:\n${[...new Set(failures)].join('\n')}`);
    }
    console.log('All visual smoke checks passed with 0 runtime errors.');
  } finally {
    await context?.close();
    await browser?.close();
    preview.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
