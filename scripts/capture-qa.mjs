import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { loadQaConfig } from './qa-config.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const QA_CONFIG = await loadQaConfig(ROOT);
const HOST = QA_CONFIG.server.host;
const PORT = QA_CONFIG.server.port;
const APP_URL = `http://${HOST}:${PORT}/`;
const START_TIMEOUT_MS = QA_CONFIG.timeouts.startMs;
const UI_TIMEOUT_MS = QA_CONFIG.timeouts.uiMs;
const VIEWPORT_SETTLE_MS = QA_CONFIG.timeouts.viewportSettleMs;
const TILE_SETTLE_MS = QA_CONFIG.timeouts.tileSettleMs;
const QA_DIR = QA_CONFIG.outputDir;
const QA_SUITE_VERSION = QA_CONFIG.suiteVersion;
const VIEWPORT = QA_CONFIG.viewport;
const TILE_PREVIEW_COUNT = QA_CONFIG.tile.previewCount;
const TILE_CHANNELS = QA_CONFIG.tile.channels;
const NATURAL_PRESETS = QA_CONFIG.naturalPresets;

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
  if (await locator.count() === 0) throw new Error(`QA capture could not find ${label}.`);
  return locator.first();
}

async function waitForViewportReady(page) {
  await page.locator('canvas.lab-canvas').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
  await page.locator('[data-role="viewport"]:not(.is-loading)').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
  await page.evaluate(() => new Promise((resolvePaint) => {
    requestAnimationFrame(() => requestAnimationFrame(resolvePaint));
  }));
  await delay(VIEWPORT_SETTLE_MS);
}

async function waitForTileReady(page) {
  await page.locator('[data-role="tile-preview"]').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-role="tile-preview"]');
    return panel?.getAttribute('aria-busy') === 'false';
  }, undefined, { timeout: UI_TIMEOUT_MS });
  await delay(TILE_SETTLE_MS);
}

async function rotateViewport(page, deltaX, deltaY, steps = 15) {
  const canvas = page.locator('canvas.lab-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('QA viewport canvas has no bounding box.');

  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps });
  await page.mouse.up();
  await waitForViewportReady(page);
}

function numberedFile(index, suffix) {
  return `${String(index).padStart(2, '0')}-${suffix}.png`;
}

function parseMetricCount(value) {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)([km]?)$/i);
  if (match === null) return null;
  const amount = Number(match[1]);
  const suffix = match[2]?.toLowerCase() ?? '';
  if (!Number.isFinite(amount)) return null;
  if (suffix === 'm') return Math.round(amount * 1_000_000);
  if (suffix === 'k') return Math.round(amount * 1_000);
  return Math.round(amount);
}

function parsePerformanceHud(raw) {
  const parts = raw.split(' · ').map((part) => part.trim());
  const fps = Number.parseFloat(parts[0]?.replace(/\s*FPS$/u, '') ?? '');
  const frameMs = Number.parseFloat(parts[1]?.replace(/\s*ms$/u, '') ?? '');
  const drawCalls = Number.parseInt(parts[2]?.replace(/\s*calls?$/u, '') ?? '', 10);
  const triangleText = parts[3]?.replace(/\s*tris$/u, '') ?? '';

  return {
    raw,
    scope: 'headless-capture-only',
    fps: Number.isFinite(fps) ? fps : null,
    frameMs: Number.isFinite(frameMs) ? frameMs : null,
    drawCalls: Number.isFinite(drawCalls) ? drawCalls : null,
    triangles: parseMetricCount(triangleText),
    quality: parts[4] ?? null,
    autoQuality: parts.includes('Auto')
  };
}

function parseSeamMetric(raw) {
  const match = raw.match(/([0-9]+)²\s*·\s*seam mismatch\s*([0-9]+(?:\.[0-9]+)?)%/iu);
  if (match === null) return { raw, resolution: null, mismatchPercent: null };
  const resolution = Number.parseInt(match[1] ?? '', 10);
  const mismatchPercent = Number.parseFloat(match[2] ?? '');
  return {
    raw,
    resolution: Number.isFinite(resolution) ? resolution : null,
    mismatchPercent: Number.isFinite(mismatchPercent) ? mismatchPercent : null
  };
}

function currentCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function readEditorSnapshot(page) {
  return page.evaluate(() => {
    function valueOf(element) {
      if (element instanceof HTMLInputElement && element.type === 'checkbox') return element.checked;
      if (element instanceof HTMLInputElement && (element.type === 'number' || element.type === 'range')) {
        const number = Number(element.value);
        return Number.isFinite(number) ? number : element.value;
      }
      return element.value;
    }

    function collect(selector, datasetKey, ignoredPeerKey = null) {
      const values = {};
      for (const element of document.querySelectorAll(selector)) {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) continue;
        if (ignoredPeerKey !== null && element.dataset[ignoredPeerKey] === 'range') continue;
        const key = element.dataset[datasetKey];
        if (key === undefined || Object.prototype.hasOwnProperty.call(values, key)) continue;
        values[key] = valueOf(element);
      }
      return values;
    }

    const selectedLayerTitle = document.querySelector('[data-role="inspector-title"]')?.textContent?.trim() ?? null;
    const selectedLayer = collect('[data-field]', 'field', 'peer');
    const physical = {
      ...collect('[data-physical-field]', 'physicalField', 'physicalPeer'),
      ...collect('[data-physical-color]', 'physicalColor')
    };
    const viewport = collect('[data-viewport-field]', 'viewportField');
    const quality = document.querySelector('[data-role="quality-select"]');

    return {
      selectedLayerTitle,
      selectedLayer,
      physical,
      viewport,
      requestedQuality: quality instanceof HTMLSelectElement ? quality.value : null
    };
  });
}

async function readPerformance(page) {
  const locator = page.locator('[data-role="performance"]');
  const raw = await locator.count() > 0
    ? (await locator.textContent())?.trim() ?? 'N/A'
    : 'N/A';
  return parsePerformanceHud(raw);
}

async function captureShot(page, qaDir, manifestRecords, entry) {
  const filePath = resolve(qaDir, entry.fileName);
  const editor = await readEditorSnapshot(page);
  const performance = await readPerformance(page);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`   Saved QA capture: ${entry.fileName} (${performance.raw})`);

  manifestRecords.push({
    file: entry.fileName,
    captureType: entry.captureType ?? 'material-preview',
    category: entry.category ?? null,
    presetId: entry.presetId,
    presetName: entry.presetName,
    geometryId: entry.geometryId,
    geometryName: entry.geometryName,
    perspective: entry.perspective,
    editor,
    performance,
    seam: entry.seamMetric === undefined ? null : parseSeamMetric(entry.seamMetric),
    seamChannels: entry.seamChannels ?? null,
    tile: entry.tile ?? null,
    notes: entry.notes,
    capturedAt: new Date().toISOString()
  });
}

async function selectPreset(page, presetId, presetLabel) {
  await (await required(page.locator(`[data-preset="${presetId}"]`), `${presetLabel} preset`)).click();
}

async function selectPresetAndObject(page, presetId, presetLabel, objectId, objectLabel) {
  await selectPreset(page, presetId, presetLabel);
  await (await required(page.locator(`[data-object="${objectId}"]`), `${objectLabel} preview object`)).click();
  await waitForViewportReady(page);
}

async function readTileChannelMetrics(page) {
  const channelSelect = await required(page.locator('[data-role="tile-channel"]'), 'Tile Lab channel selector');
  const metrics = {};

  for (const channel of TILE_CHANNELS) {
    await channelSelect.selectOption(channel);
    await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(resolvePaint)));
    const raw = (await page.locator('[data-role="tile-metrics"]').textContent())?.trim() ?? '';
    metrics[channel] = parseSeamMetric(raw);
  }

  await channelSelect.selectOption('albedo');
  await page.evaluate(() => new Promise((resolvePaint) => requestAnimationFrame(resolvePaint)));
  return metrics;
}

async function openTileLab(page, presetId, presetName) {
  await selectPreset(page, presetId, presetName);
  await (await required(page.locator('[data-command="tile-preview"]'), 'Tile Lab command')).click();
  await page.locator('.app-shell.is-tile-mode').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS });
  await waitForTileReady(page);

  const tileCount = await required(page.locator('[data-role="tile-count"]'), 'Tile Lab tile count selector');
  await tileCount.selectOption(String(TILE_PREVIEW_COUNT));
  const seamGuides = await required(page.locator('[data-role="tile-grid"]'), 'Seam guides checkbox');
  if (await seamGuides.isChecked()) await seamGuides.uncheck();
  await delay(TILE_SETTLE_MS);
}

async function closeTileLab(page) {
  const closeButton = await required(page.locator('[data-role="tile-close"]'), 'Tile Lab close button');
  await closeButton.click();
  await page.locator('.app-shell.is-tile-mode').waitFor({ state: 'detached', timeout: UI_TIMEOUT_MS }).catch(async () => {
    await page.waitForFunction(() => !document.querySelector('.app-shell')?.classList.contains('is-tile-mode'));
  });
  await waitForViewportReady(page);
}

async function captureNaturalPresetPreviews(page, qaDir, manifestRecords, startIndex) {
  let index = startIndex;
  for (const preset of NATURAL_PRESETS) {
    console.log(`${index}. Capturing ${preset.name} on ${preset.previewObjectName}...`);
    await selectPresetAndObject(
      page,
      preset.id,
      preset.name,
      preset.previewObjectId,
      preset.previewObjectName
    );
    await captureShot(page, qaDir, manifestRecords, {
      fileName: numberedFile(index, `${preset.fileStem}-${preset.previewObjectId}`),
      captureType: 'material-preview',
      category: preset.category,
      presetId: preset.id,
      presetName: preset.name,
      geometryId: preset.previewObjectId,
      geometryName: preset.previewObjectName,
      perspective: 'surface-perspective',
      notes: `${preset.notes} ${preset.previewObjectName} preview is used for consistent surface-scale and displacement comparison.`
    });
    index += 1;
  }
  return index;
}

async function captureNaturalPresetTiles(page, qaDir, manifestRecords, startIndex) {
  let index = startIndex;
  for (const preset of NATURAL_PRESETS) {
    console.log(`${index}. Capturing ${preset.name} ${TILE_PREVIEW_COUNT}×${TILE_PREVIEW_COUNT} tileability...`);
    await openTileLab(page, preset.id, preset.name);
    const seamChannels = await readTileChannelMetrics(page);
    const albedoSeam = seamChannels.albedo;
    await captureShot(page, qaDir, manifestRecords, {
      fileName: numberedFile(index, `${preset.fileStem}-tile-${TILE_PREVIEW_COUNT}x${TILE_PREVIEW_COUNT}`),
      captureType: 'tileability',
      category: preset.category,
      presetId: preset.id,
      presetName: preset.name,
      geometryId: 'plane',
      geometryName: 'Tile Canvas',
      perspective: '2d-repetition',
      seamMetric: albedoSeam?.raw ?? '',
      seamChannels,
      tile: {
        count: TILE_PREVIEW_COUNT,
        channel: 'albedo',
        seamGuides: false
      },
      notes: `${TILE_PREVIEW_COUNT}×${TILE_PREVIEW_COUNT} repeated albedo preview. Manifest records seam mismatch for all exported PBR channels.`
    });
    await closeTileLab(page);
    index += 1;
  }
  return index;
}

async function main() {
  const qaDir = resolve(ROOT, QA_DIR);
  await mkdir(qaDir, { recursive: true });

  const manifestRecords = [];
  const preview = startPreview(ROOT);
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
      viewport: VIEWPORT,
      deviceScaleFactor: 1
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

    console.log('1. Capturing Storm Marble on Rounded Cube (front perspective)...');
    await selectPresetAndObject(page, 'storm-marble', 'Storm Marble', 'rounded-cube', 'Rounded Cube');
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '01-storm-marble-rounded-front.png',
      presetId: 'storm-marble',
      presetName: 'Storm Marble',
      geometryId: 'rounded-cube',
      geometryName: 'Rounded Cube',
      perspective: 'front-perspective',
      notes: 'Default front perspective showing layered mineral veins and dark stone base.'
    });

    console.log('2. Capturing Storm Marble on Rounded Cube (rotated perspective)...');
    await rotateViewport(page, 140, -80);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '02-storm-marble-rounded-rotated.png',
      presetId: 'storm-marble',
      presetName: 'Storm Marble',
      geometryId: 'rounded-cube',
      geometryName: 'Rounded Cube',
      perspective: 'rotated-perspective',
      notes: 'Rotated perspective showing specular and clearcoat continuity across rounded beveled edges.'
    });

    console.log('3. Capturing Alien Dermis on Cube (front perspective)...');
    await selectPresetAndObject(page, 'alien-dermis', 'Alien Dermis', 'cube', 'Cube');
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '03-alien-dermis-cube-front.png',
      presetId: 'alien-dermis',
      presetName: 'Alien Dermis',
      geometryId: 'cube',
      geometryName: 'Cube',
      perspective: 'front-perspective',
      notes: 'Front perspective showing fused cellular lobules and branching vessel patterns.'
    });

    console.log('4. Capturing Alien Dermis on Cube (rotated perspective)...');
    await rotateViewport(page, 160, -90);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '04-alien-dermis-cube-rotated.png',
      presetId: 'alien-dermis',
      presetName: 'Alien Dermis',
      geometryId: 'cube',
      geometryName: 'Cube',
      perspective: 'rotated-perspective',
      notes: 'Rotated perspective showing welded cube edges remaining closed under procedural displacement.'
    });

    console.log('5. Capturing Molten Rock on Sphere (rotated perspective)...');
    await selectPresetAndObject(page, 'molten-rock', 'Molten Rock', 'sphere', 'Sphere');
    await rotateViewport(page, 100, -60);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '05-molten-rock-sphere-rotated.png',
      presetId: 'molten-rock',
      presetName: 'Molten Rock',
      geometryId: 'sphere',
      geometryName: 'Sphere',
      perspective: 'rotated-perspective',
      notes: 'Rotated perspective showing bright fissure color routing and cellular crust displacement.'
    });

    console.log('6. Capturing Adipose Tissue SSS on Torus (rotated perspective)...');
    await selectPresetAndObject(page, 'adipose-v8', 'Adipose Tissue', 'torus', 'Torus');
    await rotateViewport(page, 120, -110);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '06-adipose-tissue-torus-rotated.png',
      presetId: 'adipose-v8',
      presetName: 'Adipose Tissue · SSS',
      geometryId: 'torus',
      geometryName: 'Torus',
      perspective: 'rotated-perspective',
      notes: 'Rotated perspective showing the realtime SSS approximation, branching vessels, and wet-film clearcoat.'
    });

    console.log('7. Capturing Molten Rock on Icosphere (rotated perspective)...');
    await selectPresetAndObject(page, 'molten-rock', 'Molten Rock', 'icosphere', 'Icosphere');
    await rotateViewport(page, -120, 70);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '07-molten-rock-icosphere-rotated.png',
      presetId: 'molten-rock',
      presetName: 'Molten Rock',
      geometryId: 'icosphere',
      geometryName: 'Icosphere',
      perspective: 'rotated-perspective',
      notes: 'Rotated perspective showing procedural displacement and smooth displaced-normal response on the icosphere.'
    });

    console.log(`8. Capturing Tile Lab ${TILE_PREVIEW_COUNT}×${TILE_PREVIEW_COUNT} seamless repetition...`);
    await openTileLab(page, 'storm-marble', 'Storm Marble');
    const stormSeamChannels = await readTileChannelMetrics(page);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '08-tile-lab-3x3-seamless.png',
      captureType: 'tileability',
      presetId: 'storm-marble',
      presetName: 'Storm Marble',
      geometryId: 'plane',
      geometryName: 'Tile Canvas',
      perspective: '2d-repetition',
      seamMetric: stormSeamChannels.albedo?.raw ?? '',
      seamChannels: stormSeamChannels,
      tile: { count: TILE_PREVIEW_COUNT, channel: 'albedo', seamGuides: false },
      notes: 'Tile Lab seamless repetition grid preview with all-channel seam measurements recorded in the manifest.'
    });

    console.log('9. Capturing Tile Lab with seam guides...');
    const seamGuideCheckbox = await required(page.locator('[data-role="tile-grid"]'), 'Seam guides checkbox');
    await seamGuideCheckbox.check();
    await delay(300);
    await captureShot(page, qaDir, manifestRecords, {
      fileName: '09-tile-lab-seam-guides.png',
      captureType: 'tileability',
      presetId: 'storm-marble',
      presetName: 'Storm Marble',
      geometryId: 'plane',
      geometryName: 'Tile Canvas',
      perspective: '2d-repetition-guides',
      seamMetric: stormSeamChannels.albedo?.raw ?? '',
      seamChannels: stormSeamChannels,
      tile: { count: TILE_PREVIEW_COUNT, channel: 'albedo', seamGuides: true },
      notes: 'Tile Lab seamless repetition with seam guide overlays enabled.'
    });
    await closeTileLab(page);

    let nextIndex = await captureNaturalPresetPreviews(page, qaDir, manifestRecords, 10);
    nextIndex = await captureNaturalPresetTiles(page, qaDir, manifestRecords, nextIndex);

    if (failures.length > 0) {
      throw new Error(`QA capture runtime failures:\n${[...new Set(failures)].join('\n')}`);
    }

    const manifestPath = resolve(qaDir, 'manifest.json');
    const manifest = {
      generatedAt: new Date().toISOString(),
      qaSuiteVersion: QA_SUITE_VERSION,
      sourceCommit: currentCommit(ROOT),
      runtime: {
        browser: 'Chromium',
        browserVersion: browser.version(),
        headless: true,
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        node: process.version,
        platform: process.platform,
        performanceNote: 'HUD performance is captured from headless QA rendering and is not a real-hardware benchmark.'
      },
      naturalPresetMatrix: NATURAL_PRESETS.map(({ id, name, category }) => ({ id, name, category })),
      tileChannels: TILE_CHANNELS,
      tilePreviewCount: TILE_PREVIEW_COUNT,
      totalCaptures: manifestRecords.length,
      captures: manifestRecords
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`\nGenerated QA manifest: ${manifestPath}`);
    console.log(`All QA captures completed successfully (${manifestRecords.length} images).`);
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
