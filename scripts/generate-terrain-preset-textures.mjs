import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4182;
const START_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 120_000;
const GENERATOR_URL = `http://${HOST}:${PORT}/thumbnail-generator.html`;
const MISSING_ONLY = process.argv.includes('--missing-only');
const CHECK_ONLY = process.argv.includes('--check');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function startVite(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  const child = spawn(
    process.execPath,
    [vite, '--host', HOST, '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}

async function waitForVite() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(GENERATOR_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(150);
  }
  throw new Error('Timed out waiting for the terrain preset generator page.');
}

async function hasCachedPng(path) {
  if (!existsSync(path)) return false;
  const contents = await readFile(path);
  return contents.length >= 24 && contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function decodePng(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/u.exec(dataUrl);
  if (match?.[1] === undefined) throw new Error('Terrain preset generator returned an invalid PNG data URL.');
  return Buffer.from(match[1], 'base64');
}

async function renderPng(page, id) {
  const dataUrl = await page.evaluate(
    (presetId) => window.__PTL_THUMBNAIL_GENERATOR__.renderTerrain(presetId),
    id
  );
  return decodePng(dataUrl);
}

async function compareCachedPixels(page, id) {
  return page.evaluate(async (presetId) => {
    const expectedDataUrl = window.__PTL_THUMBNAIL_GENERATOR__.renderTerrain(presetId);
    const cacheBust = `${Date.now()}-${Math.random()}`;
    const actualUrl = `/terrain-presets/${encodeURIComponent(presetId)}.png?ptl-check=${cacheBust}`;
    const [expectedResponse, actualResponse] = await Promise.all([
      fetch(expectedDataUrl),
      fetch(actualUrl, { cache: 'no-store' })
    ]);
    if (!expectedResponse.ok || !actualResponse.ok) return false;

    const [expected, actual] = await Promise.all([
      createImageBitmap(await expectedResponse.blob()),
      createImageBitmap(await actualResponse.blob())
    ]);
    try {
      if (expected.width !== actual.width || expected.height !== actual.height) return false;
      const canvas = document.createElement('canvas');
      canvas.width = expected.width;
      canvas.height = expected.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('Could not compare terrain preset pixels.');

      context.drawImage(expected, 0, 0);
      const expectedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(actual, 0, 0);
      const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      if (expectedPixels.length !== actualPixels.length) return false;
      for (let index = 0; index < expectedPixels.length; index += 1) {
        if (expectedPixels[index] !== actualPixels[index]) return false;
      }
      return true;
    } finally {
      expected.close();
      actual.close();
    }
  }, id);
}

async function verifyCache(page, outputDirectory, presetIds) {
  const stale = [];
  for (const [index, id] of presetIds.entries()) {
    const outputPath = join(outputDirectory, `${id}.png`);
    const matches = await hasCachedPng(outputPath) && await compareCachedPixels(page, id);
    if (!matches) stale.push(id);
    console.log(`${index + 1}/${presetIds.length} ${id}${matches ? ' ok' : ' stale'}`);
  }

  if (stale.length > 0) {
    throw new Error(
      `Terrain preset cache is stale for ${stale.length} preset${stale.length === 1 ? '' : 's'}: ` +
      `${stale.join(', ')}. Run npm run terrain-presets:generate and commit the regenerated PNGs.`
    );
  }
  console.log(`All ${presetIds.length} terrain preset textures match the current renderer.`);
}

async function main() {
  if (CHECK_ONLY && MISSING_ONLY) {
    throw new Error('--check and --missing-only cannot be used together.');
  }

  const root = resolve(import.meta.dirname, '..');
  const outputDirectory = join(root, 'public', 'terrain-presets');
  await mkdir(outputDirectory, { recursive: true });

  const vite = startVite(root);
  let browser = null;
  try {
    await waitForVite();
    browser = await chromium.launch({
      headless: true,
      timeout: RENDER_TIMEOUT_MS,
      args: [
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader'
      ]
    });
    const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[browser] ${message.text()}`);
    });
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__PTL_THUMBNAIL_GENERATOR__ !== undefined);

    const presetIds = await page.evaluate(() => [...window.__PTL_THUMBNAIL_GENERATOR__.presetIds]);
    if (CHECK_ONLY) {
      await verifyCache(page, outputDirectory, presetIds);
      return;
    }

    const pending = [];
    for (const id of presetIds) {
      const outputPath = join(outputDirectory, `${id}.png`);
      if (!MISSING_ONLY || !(await hasCachedPng(outputPath))) pending.push({ id, outputPath });
    }

    if (pending.length === 0) {
      console.log(`All ${presetIds.length} terrain preset textures are already cached.`);
      return;
    }

    console.log(`Generating ${pending.length} terrain preset texture${pending.length === 1 ? '' : 's'}…`);
    for (const [index, entry] of pending.entries()) {
      await writeFile(entry.outputPath, await renderPng(page, entry.id));
      console.log(`${index + 1}/${pending.length} ${entry.id}.png`);
    }
    console.log(`Terrain preset cache ready at ${outputDirectory}.`);
  } finally {
    if (browser !== null) await browser.close();
    vite.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
