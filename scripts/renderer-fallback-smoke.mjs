import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4176;
const APP_URL = `http://${HOST}:${PORT}/`;
const TIMEOUT_MS = 30_000;

function terminate(child) {
  if (child === null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function startDevServer(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  return spawn(process.execPath, [
    vite,
    '--host', HOST,
    '--port', String(PORT),
    '--strictPort'
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for the renderer fallback test server.');
}

async function assertHealthyRenderer() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'
    ]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas.lab-canvas').waitFor({ state: 'visible' });
    await page.locator('[data-role="viewport"][data-renderer-state="ready"]').waitFor({ state: 'attached' });
    if (pageErrors.length > 0) {
      throw new Error(`Healthy renderer control emitted uncaught errors:\n${pageErrors.join('\n')}`);
    }
  } finally {
    await browser.close();
  }
}

async function assertUnavailableRendererFallback() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-3d-apis']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell').waitFor({ state: 'attached' });
    const fallback = page.locator('[data-role="renderer-fallback"]');
    await fallback.waitFor({ state: 'visible' });

    const fallbackText = await fallback.textContent();
    if (!fallbackText?.includes('3D preview unavailable')) {
      throw new Error(`Unexpected renderer fallback message: ${fallbackText ?? '<missing>'}`);
    }
    const viewportState = await page.locator('[data-role="viewport"]').getAttribute('data-renderer-state');
    if (viewportState !== 'unavailable') {
      throw new Error(`Expected unavailable renderer state, received ${viewportState ?? '<missing>'}.`);
    }

    await page.locator('[data-command="bake-textures"]').click();
    const toast = page.locator('[data-role="toast"]');
    await toast.waitFor({ state: 'visible' });
    const toastText = await toast.textContent();
    if (!toastText?.includes('WebGL2')) {
      throw new Error(`Expected a WebGL2 capability message, received ${toastText ?? '<missing>'}.`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`Renderer fallback emitted uncaught errors:\n${pageErrors.join('\n')}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const server = startDevServer(root);
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);

  try {
    await waitForServer();
    await assertHealthyRenderer();
    await assertUnavailableRendererFallback();
    console.log('Renderer fallback smoke passed without an uncaught startup error.');
  } finally {
    terminate(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
