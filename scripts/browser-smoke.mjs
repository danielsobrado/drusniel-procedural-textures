import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse as parseYaml } from 'yaml';
import {
  assertRoundtripExport,
  createRoundtripFixture,
  readGlbJson
} from './glb-roundtrip-fixture.mjs';

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4173;
const DEBUG_PORT = 9222;
const START_TIMEOUT_MS = 30_000;
const BAKE_TIMEOUT_MS = 90_000;
const EXPORT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 150;
const FIXTURE_FILE_NAME = 'ptl-roundtrip-fixture.glb';
const EXPECTED_MAP_SUFFIXES = [
  '-albedo.png',
  '-roughness.png',
  '-normal.png',
  '-height.png',
  '-clearcoat.png',
  '-clearcoat-roughness.png'
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FATAL_CONSOLE_PATTERN = /shader error|validate_status false|error:\s*0:|webglprogram.*error|uncaught|unhandled/i;
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter((value) => typeof value === 'string' && value.length > 0);

function terminate(child) {
  if (child === null || child.killed) return;
  child.kill('SIGTERM');
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function smokeConfig(root) {
  const document = parseYaml(await readFile(join(root, 'config/lab.yaml'), 'utf8'));
  const bakeResolution = document?.performance?.tiers?.mobile?.bakeResolution;
  const glbFileName = document?.export?.glbFileName;
  if (!Number.isInteger(bakeResolution) || bakeResolution <= 0 || typeof glbFileName !== 'string' || glbFileName.length === 0) {
    throw new Error('Browser smoke configuration is missing mobile bake resolution or GLB filename.');
  }
  return { bakeResolution, glbFileName };
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

  throw new Error('Chrome or Chromium was not found. Set CHROME_BIN to run the browser smoke suite.');
}

function startPreview(root) {
  const vite = resolve(root, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [
    vite,
    'preview',
    '--host', PREVIEW_HOST,
    '--port', String(PREVIEW_PORT),
    '--strictPort'
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}

async function waitForPreview() {
  const url = `http://${PREVIEW_HOST}:${PREVIEW_PORT}/`;
  await waitFor(async () => {
    const response = await fetch(url);
    return response.ok;
  }, START_TIMEOUT_MS, 'Vite preview server');
  return url;
}

function startChrome(executable, profileDir) {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,900',
    'about:blank'
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');

  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}

async function pageDebuggerUrl() {
  return waitFor(async () => {
    const response = await fetch(`http://${PREVIEW_HOST}:${DEBUG_PORT}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    const page = targets.find((target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string');
    return page?.webSocketDebuggerUrl ?? null;
  }, START_TIMEOUT_MS, 'Chrome DevTools endpoint');
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.socket.addEventListener('message', (event) => this.onMessage(event));
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, rejectOpen) => {
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolveOpen();
      };
      const onError = () => {
        cleanup();
        rejectOpen(new Error('Unable to connect to Chrome DevTools.'));
      };
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('error', onError);
    });
  }

  close() {
    this.socket.close();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(`${message.error.message ?? 'CDP command failed'} (${message.error.code ?? 'unknown'})`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method === 'string') {
      for (const listener of this.listeners) listener(message.method, message.params ?? {});
    }
  }
}

function consoleArgumentText(argument) {
  if (typeof argument.value === 'string') return argument.value;
  if (argument.value !== undefined) return JSON.stringify(argument.value);
  return typeof argument.description === 'string' ? argument.description : '';
}

async function evaluate(client, expression, returnByValue = true) {
  const result = await client.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  }
  return returnByValue ? result.result?.value : result.result;
}

async function waitForApp(client) {
  await waitFor(async () => evaluate(client, `(() => {
    const canvas = document.querySelector('canvas.lab-canvas');
    const status = document.querySelector('[data-role="status"]');
    return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0 && Boolean(status?.textContent);
  })()`), START_TIMEOUT_MS, 'application canvas');
}

async function assertWebGl(client) {
  const renderer = await evaluate(client, `(() => {
    const canvas = document.querySelector('canvas.lab-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) return null;
    return gl.getParameter(gl.RENDERER);
  })()`);
  if (typeof renderer !== 'string' || renderer.length === 0) {
    throw new Error('WebGL context was not available in the browser smoke suite.');
  }
  console.log(`WebGL renderer: ${renderer}`);
}

async function exerciseBake(client) {
  const clicked = await evaluate(client, `(() => {
    const quality = document.querySelector('[data-role="quality-select"]');
    const button = document.querySelector('[data-command="bake-textures"]');
    if (!(quality instanceof HTMLSelectElement) || !(button instanceof HTMLButtonElement)) return false;
    quality.value = 'mobile';
    quality.dispatchEvent(new Event('change', { bubbles: true }));
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error('Bake maps command was not available.');

  await waitFor(async () => evaluate(client, `(() => {
    const toast = document.querySelector('[data-role="toast"]');
    return typeof toast?.textContent === 'string' && toast.textContent.startsWith('Baked 6 maps at ');
  })()`), BAKE_TIMEOUT_MS, 'GPU texture bake');
}

async function verifyBakedMaps(downloadDir, expectedResolution) {
  const files = await waitFor(async () => {
    const entries = await readdir(downloadDir);
    if (entries.some((entry) => entry.endsWith('.crdownload'))) return null;
    return EXPECTED_MAP_SUFFIXES.every((suffix) => entries.some((entry) => entry.endsWith(suffix)))
      ? entries
      : null;
  }, BAKE_TIMEOUT_MS, 'baked PNG downloads');

  for (const suffix of EXPECTED_MAP_SUFFIXES) {
    const filename = files.find((entry) => entry.endsWith(suffix));
    if (filename === undefined) throw new Error(`Missing baked map for ${suffix}.`);
    const data = await readFile(join(downloadDir, filename));
    if (data.length < 33 || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error(`Baked map ${filename} is not a valid PNG.`);
    }
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (width !== expectedResolution || height !== expectedResolution) {
      throw new Error(`Baked map ${filename} has unexpected dimensions ${width}x${height}.`);
    }
  }
}

async function setFileInput(client, selector, files) {
  const remoteObject = await evaluate(client, `document.querySelector(${JSON.stringify(selector)})`, false);
  const objectId = remoteObject?.objectId;
  if (typeof objectId !== 'string') throw new Error(`File input ${selector} was not available.`);
  await client.command('DOM.setFileInputFiles', { files, objectId });
}

async function waitForImportedMeshes(client, expectedFileName) {
  await waitFor(async () => evaluate(client, `(() => {
    const label = document.querySelector('[data-role="object-label"]');
    const select = document.querySelector('[data-viewport-field="mesh"]');
    return label?.textContent === ${JSON.stringify(expectedFileName)} &&
      select instanceof HTMLSelectElement &&
      select.options.length === 2 &&
      Array.from(select.options).some((item) => item.textContent === 'LabMesh') &&
      Array.from(select.options).some((item) => item.textContent === 'OriginalMesh');
  })()`), START_TIMEOUT_MS, `two imported meshes from ${expectedFileName}`);
}

async function importFixture(client, path, fileName) {
  await setFileInput(client, '[data-role="model-input"]', [path]);
  await waitForImportedMeshes(client, fileName);
}

async function preserveOriginalMeshMaterial(client) {
  const selected = await evaluate(client, `(() => {
    const select = document.querySelector('[data-viewport-field="mesh"]');
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = Array.from(select.options).find((item) => item.textContent === 'OriginalMesh');
    if (option === undefined) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (selected !== true) throw new Error('Original fixture mesh could not be selected.');

  await waitFor(async () => evaluate(client, `(() => {
    const select = document.querySelector('[data-viewport-field="mesh"]');
    const checkbox = document.querySelector('[data-viewport-field="mesh-assigned"]');
    return select instanceof HTMLSelectElement &&
      select.selectedOptions[0]?.textContent === 'OriginalMesh' &&
      checkbox instanceof HTMLInputElement;
  })()`), START_TIMEOUT_MS, 'original mesh assignment control');

  const changed = await evaluate(client, `(() => {
    const checkbox = document.querySelector('[data-viewport-field="mesh-assigned"]');
    if (!(checkbox instanceof HTMLInputElement)) return false;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (changed !== true) throw new Error('Original fixture material could not be preserved.');

  await waitFor(async () => evaluate(client, `(() => {
    const checkbox = document.querySelector('[data-viewport-field="mesh-assigned"]');
    return checkbox instanceof HTMLInputElement && checkbox.checked === false;
  })()`), START_TIMEOUT_MS, 'original material assignment state');
}

async function exerciseGlbExport(client) {
  const clicked = await evaluate(client, `(() => {
    const button = document.querySelector('[data-command="export-glb"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error('Export GLB command was not available.');

  await waitFor(async () => evaluate(client, `(() => {
    const toast = document.querySelector('[data-role="toast"]');
    return typeof toast?.textContent === 'string' && /GLB/i.test(toast.textContent) && /export/i.test(toast.textContent);
  })()`), EXPORT_TIMEOUT_MS, 'GLB export');
}

async function waitForDownloadedFile(downloadDir, fileName, timeoutMs) {
  return waitFor(async () => {
    const entries = await readdir(downloadDir);
    if (entries.some((entry) => entry.endsWith('.crdownload'))) return null;
    return entries.includes(fileName) ? join(downloadDir, fileName) : null;
  }, timeoutMs, `download ${fileName}`);
}

async function exerciseGlbRoundtrip(client, fixturePath, downloadDir, glbFileName) {
  await importFixture(client, fixturePath, FIXTURE_FILE_NAME);
  await preserveOriginalMeshMaterial(client);
  await exerciseGlbExport(client);

  const exportedPath = await waitForDownloadedFile(downloadDir, glbFileName, EXPORT_TIMEOUT_MS);
  assertRoundtripExport(await readGlbJson(exportedPath));

  await importFixture(client, exportedPath, glbFileName);
  console.log('GLB export round-trip preserved source transforms, original material texture and baked PBR bindings.');
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const config = await smokeConfig(root);
  const profileDir = await mkdtemp(join(tmpdir(), 'procedural-texture-lab-chrome-'));
  const downloadDir = await mkdtemp(join(tmpdir(), 'procedural-texture-lab-downloads-'));
  const fixtureDir = await mkdtemp(join(tmpdir(), 'procedural-texture-lab-fixture-'));
  const fixturePath = join(fixtureDir, FIXTURE_FILE_NAME);
  await createRoundtripFixture(fixturePath);

  let preview = null;
  let chrome = null;
  let client = null;

  try {
    preview = startPreview(root);
    const pageUrl = await waitForPreview();
    const executable = await findChrome();
    chrome = startChrome(executable, profileDir);
    client = new CdpClient(await pageDebuggerUrl());
    await client.open();

    const failures = [];
    client.onEvent((method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails;
        failures.push(details?.exception?.description ?? details?.text ?? 'Uncaught browser exception.');
        return;
      }
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        const text = (params.args ?? []).map(consoleArgumentText).join(' ');
        if (FATAL_CONSOLE_PATTERN.test(text)) failures.push(text);
        return;
      }
      if (method === 'Log.entryAdded' && params.entry?.level === 'error') {
        const text = params.entry.text ?? '';
        if (FATAL_CONSOLE_PATTERN.test(text)) failures.push(text);
      }
    });

    await client.command('Runtime.enable');
    await client.command('Log.enable');
    await client.command('Page.enable');
    await client.command('DOM.enable');
    await client.command('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    await client.command('Page.navigate', { url: pageUrl });

    await waitForApp(client);
    await assertWebGl(client);
    await exerciseBake(client);
    await verifyBakedMaps(downloadDir, config.bakeResolution);
    await exerciseGlbRoundtrip(client, fixturePath, downloadDir, config.glbFileName);
    await delay(500);

    if (failures.length > 0) {
      throw new Error(`Browser/WebGL smoke failures:\n${[...new Set(failures)].join('\n')}`);
    }
    console.log(
      `Browser/WebGL smoke suite passed with six aligned ${config.bakeResolution}x${config.bakeResolution} maps and a reloadable GLB.`
    );
  } finally {
    client?.close();
    terminate(chrome);
    terminate(preview);
    await Promise.all([
      rm(profileDir, { recursive: true, force: true }),
      rm(downloadDir, { recursive: true, force: true }),
      rm(fixtureDir, { recursive: true, force: true })
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
