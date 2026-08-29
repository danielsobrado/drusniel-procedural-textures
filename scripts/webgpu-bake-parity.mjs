#!/usr/bin/env node
/**
 * Runs the browser-side WebGPU/WebGL bake parity gate.
 *
 * Usage: node scripts/webgpu-bake-parity.mjs [--resolution 256] [--threshold 2] [--presets 4]
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
const PORT = 4319;
const START_TIMEOUT_MS = 60_000;
const PARITY_TIMEOUT_MS = 600_000;
const WEBGL_BROWSER_ARGS = [
  '--ignore-gpu-blocklist',
  '--use-angle=gl'
];
const WEBGPU_BROWSER_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist'
];

function parseArg(name, fallback, min, max) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

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

async function waitForServer(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Timed out waiting for the parity dev server.');
}

const root = resolve(import.meta.dirname, '..');
const resolution = parseArg('resolution', 256, 1, 4096);
const threshold = parseArg('threshold', 2, 0, 255);
const presets = parseArg('presets', 4, 1, 1000);
const pageUrl = (mode) =>
  `http://${HOST}:${PORT}/bake-parity.html?mode=${mode}&resolution=${resolution}&threshold=${threshold}&presets=${presets}`;

async function runPhase(mode, args, headless, references) {
  const phaseBrowser = await chromium.launch({ headless, args });
  try {
    const page = await phaseBrowser.newPage();
    page.setDefaultTimeout(PARITY_TIMEOUT_MS);
    page.on('console', (message) => {
      if (message.type() === 'error' || message.text().startsWith('[parity]')) {
        console.log(`[browser ${message.type()}] ${message.text()}`);
      }
    });
    if (references !== undefined) {
      await page.addInitScript((bundle) => {
        window.ptlBakeReferences = bundle;
      }, references);
    }
    await page.goto(pageUrl(mode), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ptlBakeParity !== undefined);
    const report = await page.evaluate(() => window.ptlBakeParity);
    if (report === undefined) throw new Error(`Parity ${mode} phase completed without a report.`);
    if (report.error !== undefined) throw new Error(report.error);
    return report;
  } finally {
    await phaseBrowser.close();
  }
}

let server;
let exitCode = 1;

try {
  server = startVite(root);
  await waitForServer(`http://${HOST}:${PORT}/bake-parity.html`);

  const reference = await runPhase('reference', WEBGL_BROWSER_ARGS, true);
  if (reference.references === undefined) {
    throw new Error('Parity reference phase did not return serialized bake data.');
  }
  const report = await runPhase('candidate', WEBGPU_BROWSER_ARGS, false, reference.references);

  if (process.env.PARITY_JSON) console.log(JSON.stringify(report, null, 2));
  console.log(`WebGPU bake parity at ${report.resolution}px, threshold ${report.threshold}/255\n`);
  let usedFilterAllowance = false;
  for (const preset of report.presets) {
    console.log(`  ${preset.preset}${preset.isControl ? '  [exact control]' : '  [threshold gated]'}`);
    for (const channel of preset.channels) {
      const limit = preset.isControl ? 0 : report.threshold;
      const strict = channel.maxDelta <= limit;
      const isolatedFilterDifference = !preset.isControl &&
        channel.maxDelta === limit + 1 &&
        channel.meanDelta <= limit / 10;
      usedFilterAllowance ||= isolatedFilterDifference;
      const flag = strict ? 'ok  ' : isolatedFilterDifference ? 'ok* ' : 'FAIL';
      console.log(
        `    ${flag} ${channel.channel.padEnd(20)} max ${String(channel.maxDelta).padStart(3)}` +
        `  glsl~${channel.referenceMean.toFixed(1).padStart(6)}` +
        `  tsl~${channel.candidateMean.toFixed(1).padStart(6)}`
      );
    }
  }
  if (usedFilterAllowance) {
    console.log(
      `  * isolated filtered-sample outlier; mean delta remains within ${report.threshold / 10}/255`
    );
  }
  console.log('');
  console.log(report.ok
    ? 'PASS: the control is exact and authored presets stay within tolerance.'
    : 'FAIL: at least one bake channel exceeded its parity limit.');
  exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(`Parity harness error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  server?.kill('SIGTERM');
}

process.exit(exitCode);
