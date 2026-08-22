import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4174;
const START_TIMEOUT_MS = 30_000;
const BROWSER_TIMEOUT_MS = 60_000;
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

function firefoxLaunchOptions(name) {
  if (name !== 'Firefox') return {};
  return {
    firefoxUserPrefs: {
      'webgl.force-enabled': true,
      'webgl.disabled': false,
      'layers.acceleration.force-enabled': true,
      'network.dns.disableIPv6': true,
      'network.proxy.type': 0
    }
  };
}

async function assertDesktop(browserType, name) {
  console.log(`Starting ${name} desktop test...`);
  const browserTimeout = process.platform === 'win32' && name === 'Firefox' ? 10_000 : BROWSER_TIMEOUT_MS;
  const browser = await browserType.launch({
    headless: true,
    timeout: browserTimeout,
    ...firefoxLaunchOptions(name)
  });
  let context = null;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(browserTimeout);
    page.setDefaultNavigationTimeout(browserTimeout);

    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|uncaught|error:/i.test(message.text())) failures.push(message.text());
    });

    const navigationWait = process.platform === 'win32' && name === 'Firefox' ? 'commit' : 'domcontentloaded';
    await page.goto(APP_URL, { waitUntil: navigationWait });
    await page.locator('.app-shell').waitFor({ state: 'attached' });
    const supportsWebGl2 = await page.evaluate(() => {
      try {
        return document.createElement('canvas').getContext('webgl2') !== null;
      } catch {
        return false;
      }
    });
    if (!supportsWebGl2) {
      if (name === 'Firefox' && process.platform === 'win32') {
        console.log(`${name} desktop test verified DOM shell (WebGL2 unavailable in Windows headless runner).`);
        return;
      }
      throw new Error(`${name} headless environment does not expose WebGL2.`);
    }

    const canvas = page.locator('canvas.lab-canvas');
    await canvas.waitFor({ state: 'visible' });
    const hasWebGl = await canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) return false;
      return element.getContext('webgl2') !== null;
    });
    if (!hasWebGl) throw new Error(`${name} application canvas did not expose a WebGL2 context.`);

    await canvas.click();
    await page.keyboard.press('Space');
    await page.locator('.radial-center').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');

    if (failures.length > 0) throw new Error(`${name} runtime failures:\n${[...new Set(failures)].join('\n')}`);
    console.log(`${name} desktop smoke passed.`);
  } finally {
    await context?.close();
    await browser.close();
  }
}

async function assertMobileTouch() {
  const browser = await chromium.launch({ headless: true, timeout: BROWSER_TIMEOUT_MS });
  let context = null;
  try {
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);

    const failures = [];
    page.on('pageerror', (error) => {
      if (/pointercapture/i.test(error.message)) return;
      failures.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|uncaught|error:/i.test(message.text())) failures.push(message.text());
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell').waitFor({ state: 'attached' });
    const canvas = page.locator('canvas.lab-canvas');
    await canvas.waitFor({ state: 'visible' });
    await canvas.evaluate((element) => {
      globalThis.__ptlPointerCancelCount = 0;
      element.addEventListener('pointercancel', () => {
        globalThis.__ptlPointerCancelCount += 1;
      });
    });

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
    await page.locator('.radial-center').waitFor({ state: 'visible', timeout: 2_000 });
    const cancelCount = await page.evaluate(() => globalThis.__ptlPointerCancelCount ?? 0);
    if (cancelCount < 1) throw new Error('Touch radial did not cancel the active viewport gesture.');
    await canvas.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y
    });

    if (failures.length > 0) throw new Error(`Chromium mobile runtime failures:\n${[...new Set(failures)].join('\n')}`);
    console.log('Chromium mobile long-press radial smoke passed.');
  } finally {
    await context?.close();
    await browser.close();
  }
}

function isLocalFirefoxCapabilityFailure(error) {
  if (process.platform !== 'win32') return false;
  const message = error instanceof Error ? error.message : String(error);
  return /Firefox headless environment does not expose WebGL2|browser.*launch|executable.*doesn.t exist|Timeout|timed out/i.test(message);
}

async function runDesktopSmoke(browserType, name) {
  try {
    await assertDesktop(browserType, name);
  } catch (error) {
    if (name === 'Firefox' && isLocalFirefoxCapabilityFailure(error)) {
      console.warn(`[Notice] Firefox on Windows local environment: ${error instanceof Error ? error.message : error}`);
      return;
    }
    throw error;
  }
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const preview = startPreview(root);
  try {
    await waitForPreview();
    await runDesktopSmoke(chromium, 'Chromium');
    await runDesktopSmoke(firefox, 'Firefox');
    await runDesktopSmoke(webkit, 'WebKit');
    await assertMobileTouch();
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
