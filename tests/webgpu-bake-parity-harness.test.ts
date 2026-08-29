import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const paritySource = readFileSync(new URL('../src/bake-parity.ts', import.meta.url), 'utf8');
const harnessSource = readFileSync(
  new URL('../scripts/webgpu-bake-parity.mjs', import.meta.url),
  'utf8'
);
const packageDocument = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts?: Record<string, string> };

describe('WebGPU bake parity harness', () => {
  it('fails instead of silently accepting the Three.js WebGL fallback', () => {
    expect(paritySource).toContain('backend?.isWebGPUBackend !== true');
    expect(paritySource).toContain('WebGPU parity requires a real WebGPU backend');
  });

  it('samples across the authored preset catalog instead of only its first entries', () => {
    expect(paritySource).toContain('selectParityPresets(presetLimit)');
    expect(paritySource).toContain('MATERIAL_PRESETS.length - 1');
    expect(paritySource).not.toContain('MATERIAL_PRESETS.slice(0, presetLimit)');
  });

  it('starts the pinned local Vite binary without an npx shell wrapper', () => {
    expect(harnessSource).toContain("resolve(root, 'node_modules/vite/bin/vite.js')");
    expect(harnessSource).toContain('process.execPath');
    expect(harnessSource).not.toContain("spawn('npx'");
  });

  it('isolates the software WebGL reference from the real WebGPU candidate', () => {
    expect(harnessSource).toContain("runPhase('reference', WEBGL_BROWSER_ARGS, true)");
    expect(harnessSource).toContain("runPhase('candidate', WEBGPU_BROWSER_ARGS, false");
    expect(harnessSource).toContain("'--use-angle=gl'");
    expect(paritySource).toContain('SerializedReferenceBundle');
    expect(paritySource).toContain('window.ptlBakeReferences');
  });

  it('rejects invalid CLI values instead of silently weakening the gate', () => {
    expect(harnessSource).toContain('!Number.isInteger(value)');
    expect(harnessSource).toContain("parseArg('threshold', 2, 0, 255)");
    expect(harnessSource).toContain("parseArg('presets', 4, 1, 1000)");
  });

  it('gates releases on WebGPU bake parity', () => {
    expect(packageDocument.scripts?.['release:check']).toContain('npm run test:bake-parity');
  });
});
