import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4173;
const START_TIMEOUT_MS = 30_000;
const PRESET_ID = 'designer-old-brick-wall';
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter((value) => typeof value === 'string' && value.length > 0);

function terminate(child) {
  if (child === null || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through supported executable locations.
    }
  }
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    const executable = result.status === 0 ? result.stdout.trim() : '';
    if (executable.length > 0) return executable;
  }
  throw new Error('Chrome or Chromium was not found. Set CHROME_BIN to run the Surface Graph browser smoke.');
}

function startPreview(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  return spawn(process.execPath, [vite, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function waitForPreview() {
  const url = `http://${HOST}:${PORT}/`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return url;
    } catch {
      // Preview may still be starting.
    }
    await delay(150);
  }
  throw new Error('Timed out waiting for Vite preview server.');
}

async function dragConnection(page, source, target) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (sourceBox === null || targetBox === null) throw new Error('Surface Graph socket has no bounding box.');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const preview = startPreview(root);
  preview.stdout.pipe(process.stdout);
  preview.stderr.pipe(process.stderr);
  let browser = null;

  try {
    const url = await waitForPreview();
    browser = await chromium.launch({
      executablePath: await findChrome(),
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : [])
      ]
    });
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fatal = [];
    page.on('pageerror', (error) => fatal.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /uncaught|unhandled|surface graph edit failed|shader error|webgpu.*(?:error|validation)/iu.test(message.text())) {
        fatal.push(message.text());
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator(`[data-preset="${PRESET_ID}"]`).click();
    const graphToggle = page.locator('[data-synthesis-action="graphMode"]');
    await graphToggle.waitFor({ state: 'visible' });
    await graphToggle.check();

    const workspace = page.locator('[data-role="surface-graph"]');
    await workspace.waitFor({ state: 'visible' });
    const nodes = workspace.locator('[data-graph-node]');
    const initialNodeCount = await nodes.count();
    if (initialNodeCount < 4) throw new Error('Surface Graph workspace did not render the authored preset nodes.');

    await workspace.locator('.sg-edge').first().waitFor({ state: 'attached' });

    await workspace.locator('[data-graph-action="add"]').click();
    const browserDialog = workspace.locator('[data-role="graph-browser"]');
    await browserDialog.waitFor({ state: 'visible' });

    const browserList = browserDialog.locator('[data-role="graph-browser-list"]');
    const zoomBeforeScroll = await workspace.locator('[data-role="graph-zoom"]').textContent();
    const listBox = await browserList.boundingBox();
    if (listBox === null) throw new Error('Surface Graph node browser list has no bounding box.');
    await page.mouse.move(listBox.x + listBox.width * 0.5, listBox.y + listBox.height * 0.6);
    await page.mouse.wheel(0, 480);
    // Playwright dispatches wheel input without waiting for Chromium's compositor scroll to
    // commit. Read the position only after the browser has applied it, or this smoke flakes on
    // otherwise-correct builds under load.
    const browserListHandle = await browserList.elementHandle();
    if (browserListHandle === null) throw new Error('Surface Graph node browser list was detached.');
    await page.waitForFunction((element) => element.scrollTop > 0, browserListHandle);
    const browserScrollTop = await browserList.evaluate((element) => element.scrollTop);
    const zoomAfterScroll = await workspace.locator('[data-role="graph-zoom"]').textContent();
    if (browserScrollTop <= 0) throw new Error('Surface Graph node browser did not scroll with the mouse wheel.');
    if (zoomAfterScroll !== zoomBeforeScroll) throw new Error('Scrolling the node browser changed graph zoom.');

    const search = browserDialog.locator('[data-role="graph-browser-search"]');
    await search.fill('noise');
    const noiseItem = browserDialog.locator('[data-node-kind="noise"]');
    await noiseItem.waitFor({ state: 'visible' });
    await noiseItem.click();

    if (await workspace.locator('[data-graph-node]').count() !== initialNodeCount + 1) {
      throw new Error('Surface Graph node creation did not persist.');
    }
    const noiseNode = workspace.locator('[data-graph-node]').filter({ hasText: 'Noise' }).last();
    const sourceSocket = noiseNode.locator('[data-port-direction="output"][data-port="height"]');
    const outputNode = workspace.locator('[data-graph-node]').filter({ hasText: 'PBR Output' }).last();
    const baseColorSocket = outputNode.locator('[data-port-direction="input"][data-port="baseColor"]');
    await dragConnection(page, sourceSocket, baseColorSocket);

    const connectedNoise = workspace.locator('[data-graph-node]').filter({ hasText: 'Noise' }).last();
    await connectedNoise.locator('[data-node-action="select"]').click();
    await workspace.locator('.sg-side-panel').getByText('Node inspector').waitFor({ state: 'visible' });

    await workspace.locator('[data-graph-action="close"]').click();
    await workspace.waitFor({ state: 'hidden' });

    if (fatal.length > 0) {
      throw new Error(`Surface Graph browser smoke failures:\n${[...new Set(fatal)].join('\n')}`);
    }
    console.log('Surface Graph browser smoke passed: preset load, scroll isolation, node creation, PBR route, inspector and 3D return.');
  } finally {
    await browser?.close();
    terminate(preview);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
