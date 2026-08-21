import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { readGlbJson } from './glb-roundtrip-fixture.mjs';
import {
  assertProductionExport,
  createProductionExportFixture,
  PRODUCTION_FIXTURE_FILE_NAME,
  PRODUCTION_MESH_NAMES
} from './production-export-fixture.mjs';

const HOST = '127.0.0.1';
const PORT = 4175;
const APP_URL = `http://${HOST}:${PORT}/`;
const START_TIMEOUT_MS = 30_000;
const EXPORT_TIMEOUT_MS = 120_000;

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

async function waitForImportedMeshes(page, fileName) {
  await page.waitForFunction(({ expectedFileName, names }) => {
    const label = document.querySelector('[data-role="object-label"]');
    const select = document.querySelector('[data-viewport-field="mesh"]');
    if (!(select instanceof HTMLSelectElement) || label?.textContent !== expectedFileName) return false;
    const labels = Array.from(select.options).map((option) => option.textContent);
    return labels.length === names.length && names.every((name) => labels.includes(name));
  }, { expectedFileName: fileName, names: PRODUCTION_MESH_NAMES }, { timeout: START_TIMEOUT_MS });
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const fixtureDir = await mkdtemp(join(tmpdir(), 'ptl-production-export-'));
  const fixturePath = join(fixtureDir, PRODUCTION_FIXTURE_FILE_NAME);
  const exportedPath = join(fixtureDir, 'roundtrip.glb');
  await createProductionExportFixture(fixturePath);

  const preview = startPreview(root);
  let browser = null;
  try {
    await waitForPreview();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|uncaught|error:/i.test(message.text())) failures.push(message.text());
    });

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.locator('[data-role="model-input"]').setInputFiles(fixturePath);
    await waitForImportedMeshes(page, PRODUCTION_FIXTURE_FILE_NAME);

    await page.locator('[data-role="quality-select"]').selectOption('mobile');
    const downloadPromise = page.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS });
    await page.locator('[data-command="export-glb"]').click();
    const download = await downloadPromise;
    await download.saveAs(exportedPath);

    const json = await readGlbJson(exportedPath);
    assertProductionExport(json);

    await page.locator('[data-role="model-input"]').setInputFiles(exportedPath);
    await waitForImportedMeshes(page, 'roundtrip.glb');
    await delay(300);
    if (failures.length > 0) {
      throw new Error(`Production export browser failures:\n${[...new Set(failures)].join('\n')}`);
    }
    console.log(
      'Production export smoke passed: static auto-UV packing, shared PBR atlas, displaced silhouette, Khronos validation and reload.'
    );
    await context.close();
  } finally {
    await browser?.close();
    preview.kill('SIGTERM');
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
