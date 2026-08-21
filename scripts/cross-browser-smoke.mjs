import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4174;
const START_TIMEOUT_MS = 30_000;
const APP_URL = `http://${HOST}:${PORT}/`;

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
  throw new Error('Timed out waiting for the production preview server.');
}

async function assertDesktop(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|uncaught|error:/i.test(message.text())) failures.push(message.text());
    });
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('canvas.lab-canvas').waitFor({ state: 'visible' });
    const hasWebGl = await page.locator('canvas.lab-canvas').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
    });
    if (!hasWebGl) throw new Error(`${name} did not expose a WebGL context.`);
    await page.keyboard.press('Space');
    await page.locator('.radial-menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    if (failures.length > 0) throw new Error(`${name} runtime failures:\n${[...new Set(failures)].join('\n')}`);
    console.log(`${name} desktop smoke passed.`);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function assertMobileTouch() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    const canvas = page.locator('canvas.lab-canvas');
    await canvas.waitFor({ state: 'visible' });
    const box = await canvas.boundingBox();
    if (box === null) throw new Error('Mobile viewport canvas has no bounding box.');
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.5;
    await canvas.dispatchEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y
    });
    await delay(650);
    await page.locator('.radial-menu').waitFor({ state: 'visible', timeout: 2_000 });
    await canvas.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y
    });
    console.log('Chromium mobile long-press radial smoke passed.');
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const preview = startPreview(root);
  try {
    await waitForPreview();
    await assertDesktop(chromium, 'Chromium');
    await assertDesktop(firefox, 'Firefox');
    await assertDesktop(webkit, 'WebKit');
    await assertMobileTouch();
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
