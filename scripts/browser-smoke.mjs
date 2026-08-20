import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4173;
const DEBUG_PORT = 9222;
const START_TIMEOUT_MS = 30_000;
const BAKE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 150;
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

async function evaluate(client, expression) {
  const result = await client.command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
  }
  return result.result?.value;
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

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const profileDir = await mkdtemp(join(tmpdir(), 'procedural-texture-lab-chrome-'));
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
    await client.command('Page.navigate', { url: pageUrl });

    await waitForApp(client);
    await assertWebGl(client);
    await exerciseBake(client);
    await delay(500);

    if (failures.length > 0) {
      throw new Error(`Browser/WebGL smoke failures:\n${[...new Set(failures)].join('\n')}`);
    }
    console.log('Browser/WebGL smoke suite passed.');
  } finally {
    client?.close();
    terminate(chrome);
    terminate(preview);
    await rm(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
