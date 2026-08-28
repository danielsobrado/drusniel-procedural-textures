import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const safetyCss = readFileSync(new URL('../src/styles/webgpu-safety.css', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const VIEWPORT_OVERLAYS = [
  '.viewport-badge',
  '.viewport-help',
  '.performance-hud',
  '.drop-overlay',
  '.radial-center',
  '.radial-item',
  '.popup-menu',
  '.toast',
  '.viewport::before',
  '.viewport::after'
] as const;

describe('WebGPU overlay safety', () => {
  it('disables backdrop filtering on UI that can cover the WebGPU canvas', () => {
    for (const selector of VIEWPORT_OVERLAYS) expect(safetyCss).toContain(selector);
    expect(safetyCss).toContain('-webkit-backdrop-filter: none !important;');
    expect(safetyCss).toContain('backdrop-filter: none !important;');
  });

  it('loads the safety overrides after the visual theme', () => {
    const themeIndex = mainSource.indexOf("./styles/marble-glass.css");
    const safetyIndex = mainSource.indexOf("./styles/webgpu-safety.css");
    expect(themeIndex).toBeGreaterThanOrEqual(0);
    expect(safetyIndex).toBeGreaterThan(themeIndex);
  });
});
