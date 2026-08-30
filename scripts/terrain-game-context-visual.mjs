import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4194;
const URL = `http://${HOST}:${PORT}/`;
const OUTPUT = 'artifacts/tile-lab-game-context';
const TIMEOUT = 120_000;

function terminate(child) {
  if (child === null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function startPreview(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  return spawn(process.execPath, [
    vite,
    'preview',
    '--host', HOST,
    '--port', String(PORT),
    '--strictPort'
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // Preview is still starting.
    }
    await delay(150);
  }
  throw new Error('Timed out waiting for the Tile Lab visual preview server.');
}

async function assignPreset(page, material, preset) {
  const select = page.locator(`[data-material-preset="${material}"]`);
  await select.selectOption(preset);
  await page.waitForFunction(({ materialId, presetId }) => {
    const slot = document.querySelector(`[data-material-slot="${materialId}"]`);
    const selected = document.querySelector(`[data-material-preset="${materialId}"]`);
    return slot !== null && !slot.classList.contains('is-loading') && selected?.value === presetId;
  }, { materialId: material, presetId: preset });
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const output = resolve(root, OUTPUT);
  await mkdir(output, { recursive: true });
  const preview = startPreview(root);
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(TIMEOUT);
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.locator('[data-command="tile-preview"]').click();
    await page.locator('[data-role="terrain-map"]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => !document.querySelector('[data-role="terrain-status"]')?.textContent?.includes('… %')
    );

    await assignPreset(page, 'grass', 'forest-moss-carpet');
    await assignPreset(page, 'rock', 'cut-cobble-stone');
    await assignPreset(page, 'mud', 'designer-old-brick-wall');
    await assignPreset(page, 'snow', 'designer-clay-roof-tiles');

    // A context click must be read-only; erasing begins only after a guarded right-drag.
    const map = page.locator('[data-role="terrain-map"]');
    const paintRevisionBeforeContext = await page.locator('.terrain-tile-host')
      .getAttribute('data-paint-revision') ?? '0';
    await map.click({ button: 'right', position: { x: 330, y: 280 } });
    await page.locator('.material-radial').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await delay(100);
    if ((await page.locator('.terrain-tile-host').getAttribute('data-paint-revision') ?? '0') !==
        paintRevisionBeforeContext) {
      throw new Error('A right-click changed the 2D paint map before opening the radial picker.');
    }

    // CDP touch input creates a real active pointer, including legal pointer capture. A
    // DOM-dispatched PointerEvent does not, and would test an impossible browser state.
    const mapBox = await map.boundingBox();
    const touchPoint = { x: mapBox.x + 260, y: mapBox.y + 220 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: touchPoint.x, y: touchPoint.y }]
    });
    await page.locator('.material-radial').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    });
    await cdp.detach();
    if ((await page.locator('.terrain-tile-host').getAttribute('data-paint-revision') ?? '0') !==
        paintRevisionBeforeContext) {
      throw new Error('A touch long-press painted the map before opening the radial picker.');
    }

    await page.locator('[data-preview="3d"]').click();
    const canvas = page.locator('[data-role="terrain-mesh"]');
    await canvas.waitFor({ state: 'visible' });
    await delay(1500);

    await page.screenshot({ path: resolve(output, 'tile-lab-overview.png'), fullPage: true });
    await canvas.screenshot({ path: resolve(output, 'tile-lab-overview-stage.png') });
    const radialBaseline = await canvas.screenshot({ path: resolve(output, 'tile-lab-radial-baseline.png') });

    // The radial picker, opened by right-clicking the surface it will retexture.
    await canvas.click({ button: 'right', position: { x: 420, y: 380 } });
    await page.locator('.material-radial').waitFor({ state: 'visible' });
    await delay(900);
    await page.screenshot({ path: resolve(output, 'tile-lab-radial.png'), fullPage: true });

    // Exercise the actual async interaction, not only the open menu. Switching candidates
    // must leave the newest one active, leaving the ring must restore the exact canvas, and
    // clicking must commit through the native select.
    const petals = page.locator('.material-radial-ring[role="listbox"] [data-radial-preset]');
    const petalIds = await petals.evaluateAll((nodes) => nodes
      .map((node) => node.getAttribute('data-radial-preset'))
      .filter((id) => id));
    const candidates = petalIds.filter((id) => id !== 'forest-moss-carpet').slice(0, 2);
    if (candidates.length < 2) throw new Error('Radial visual test needs two preset candidates.');
    const first = page.locator(`[data-radial-preset="${candidates[0]}"]`);
    const second = page.locator(`[data-radial-preset="${candidates[1]}"]`);
    await first.hover();
    await page.waitForFunction((presetId) =>
      document.querySelector('.terrain-tile-host')?.getAttribute('data-radial-preview-preset') === presetId,
    candidates[0]);
    const hoveredCanvas = await canvas.screenshot({ path: resolve(output, 'tile-lab-radial-hover.png') });
    if (hoveredCanvas.equals(radialBaseline)) {
      throw new Error('Radial hover preview did not change the terrain canvas.');
    }
    await second.hover();
    await page.waitForFunction((presetId) =>
      document.querySelector('.terrain-tile-host')?.getAttribute('data-radial-preview-preset') === presetId,
    candidates[1]);
    await delay(500);
    const activeAfterDelay = await page.locator('.terrain-tile-host').getAttribute('data-radial-preview-preset');
    if (activeAfterDelay !== candidates[1]) {
      throw new Error(`Stale radial preview won the race: expected ${candidates[1]}, got ${activeAfterDelay}.`);
    }
    await page.locator('.material-radial-backdrop').hover({ position: { x: 4, y: 4 } });
    await page.waitForFunction(() =>
      !document.querySelector('.terrain-tile-host')?.hasAttribute('data-radial-preview-preset'));
    await delay(150);
    await canvas.screenshot({ path: resolve(output, 'tile-lab-radial-restored.png') });
    const restoredState = await page.locator('.terrain-tile-host')
      .getAttribute('data-radial-preview-restored');
    if (restoredState !== 'true') {
      throw new Error('Leaving the radial picker did not restore the committed material ownership state.');
    }
    await second.click();
    await page.locator('.material-radial').waitFor({ state: 'hidden' });
    await page.waitForFunction(({ materialId, presetId }) => {
      const slot = document.querySelector(`[data-material-slot="${materialId}"]`);
      const selected = document.querySelector(`[data-material-preset="${materialId}"]`);
      return slot !== null && !slot.classList.contains('is-loading') && selected?.value === presetId;
    }, { materialId: 'grass', presetId: candidates[1] });
    await assignPreset(page, 'grass', 'forest-moss-carpet');
    await delay(400);

    // The toolbar shortcut must produce a useful human-scale inspection in one action.
    await page.locator('[data-role="terrain-inspect"]').click();
    await page.locator('[data-role="terrain-scale-ref"]').waitFor({ state: 'attached' });
    await page.waitForFunction(() =>
      document.querySelector('[data-role="terrain-scale-ref"]')?.checked === true);
    await delay(1200);
    await canvas.screenshot({ path: resolve(output, 'tile-lab-inspect.png') });
    await page.locator('[data-role="terrain-scale-ref"]').uncheck();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Zoom back to an overview for representative player placement.
    for (let step = 0; step < 4; step += 1) {
      await page.mouse.wheel(0, 760);
      await delay(120);
    }
    await delay(600);

    await page.locator('[data-role="terrain-player"]').click();
    await canvas.click({ position: { x: 280, y: 360 } });
    await page.waitForFunction(() => {
      const overlay = document.querySelector('.terrain-player-overlay');
      return overlay?.getAttribute('data-state') === 'playing';
    });
    await page.waitForFunction(() => {
      const aim = document.querySelector('[data-role="terrain-player-target-material"]')?.textContent ?? '';
      const marker = document.querySelector('.terrain-tile-host')?.getAttribute('data-map-marker');
      return aim.startsWith('Aim:') && !aim.includes('beyond probe range') && marker !== null;
    });
    await delay(600);
    await page.screenshot({ path: resolve(output, 'tile-lab-player.png'), fullPage: true });
    await canvas.screenshot({ path: resolve(output, 'tile-lab-player-stage.png') });

    // Lighting changes how a material reads more than any other single control, so the
    // visual record covers the range rather than one canned sun. Pointer lock is released
    // first: selecting from the toolbar drops the lock anyway, and the resulting overlay
    // change makes an element screenshot race the layout.
    await page.keyboard.press('Escape');
    await delay(400);
    for (const preset of ['dawn', 'morning', 'noon', 'golden', 'dusk', 'overcast', 'studio']) {
      await page.locator('[data-role="terrain-lighting"]').selectOption(preset);
      await delay(1200);
      await canvas.screenshot({ path: resolve(output, `tile-lab-player-${preset}.png`) });
    }

    if (failures.length > 0) {
      throw new Error(`Tile Lab visual run reported errors:\n${[...new Set(failures)].join('\n')}`);
    }
    console.log(`Tile Lab game-context screenshots written to ${output}.`);
  } finally {
    await browser?.close();
    terminate(preview);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
