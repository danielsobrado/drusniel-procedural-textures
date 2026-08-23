import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4181;
const START_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 120_000;
const GENERATOR_URL = `http://${HOST}:${PORT}/thumbnail-generator.html`;
const FORCE = process.argv.includes('--force');
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
  throw new Error('Timed out waiting for the thumbnail generator page.');
}

async function hasCachedPng(path) {
  if (!existsSync(path)) return false;
  const contents = await readFile(path);
  return contents.length >= 24 && contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function decodePng(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/u.exec(dataUrl);
  if (match?.[1] === undefined) throw new Error('Thumbnail renderer returned an invalid PNG data URL.');
  return Buffer.from(match[1], 'base64');
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const outputDirectory = join(root, 'public', 'thumbnails', 'presets');
  await mkdir(outputDirectory, { recursive: true });

  const vite = startVite(root);
  let browser = null;
  try {
    await waitForVite();
    browser = await chromium.launch({ headless: true, timeout: RENDER_TIMEOUT_MS });
    const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[browser] ${message.text()}`);
    });
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__PTL_THUMBNAIL_GENERATOR__ !== undefined);

    const presetIds = await page.evaluate(() => [...window.__PTL_THUMBNAIL_GENERATOR__.presetIds]);
    const pending = [];
    for (const id of presetIds) {
      const outputPath = join(outputDirectory, `${id}.png`);
      if (FORCE || !(await hasCachedPng(outputPath))) pending.push({ id, outputPath });
    }

    if (pending.length === 0) {
      console.log(`All ${presetIds.length} preset thumbnails are already cached.`);
      return;
    }

    console.log(`Generating ${pending.length} missing preset thumbnail${pending.length === 1 ? '' : 's'}…`);
    for (const [index, entry] of pending.entries()) {
      const dataUrl = await page.evaluate(
        (id) => window.__PTL_THUMBNAIL_GENERATOR__.render(id),
        entry.id
      );
      await writeFile(entry.outputPath, decodePng(dataUrl));
      console.log(`${index + 1}/${pending.length} ${entry.id}.png`);
    }
    console.log(`Thumbnail cache ready at ${outputDirectory}.`);
  } finally {
    if (browser !== null) await browser.close();
    vite.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
