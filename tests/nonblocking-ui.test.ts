import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const thumbnailSource = readFileSync(
  new URL('../src/export/PresetThumbnailRenderer.ts', import.meta.url),
  'utf8'
);
const bakerSource = readFileSync(new URL('../src/export/TextureBaker.ts', import.meta.url), 'utf8');
const seamlessSource = readFileSync(new URL('../src/export/SeamlessTexture.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/engine/LabRenderer.ts', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/ui/Inspector.ts', import.meta.url), 'utf8');
const layerStripSource = readFileSync(new URL('../src/ui/LayerStrip.ts', import.meta.url), 'utf8');
const canvasSource = readFileSync(new URL('../src/utils/canvas.ts', import.meta.url), 'utf8');

describe('nonblocking interactive paths', () => {
  it('uses asynchronous GPU readback for thumbnails and baked maps', () => {
    expect(thumbnailSource).toContain('readRenderTargetPixelsAsync');
    expect(thumbnailSource).not.toContain('.readRenderTargetPixels(');
    expect(bakerSource).toContain('readRenderTargetPixelsAsync');
    expect(bakerSource).not.toContain('.readRenderTargetPixels(');
  });

  it('encodes PNG output asynchronously', () => {
    expect(canvasSource).toContain('canvas.toBlob(');
    expect(rendererSource).toContain('return canvasToPngDataUrl(this.canvas);');
    expect(rendererSource).not.toContain("this.canvas.toDataURL('image/png')");
  });

  it('does not keep a synchronous bulk thumbnail path', () => {
    expect(rendererSource).not.toContain('generatePresetThumbnails(');
    expect(thumbnailSource).not.toContain('public render(');
  });

  it('does not traverse selected mesh bounds every render frame', () => {
    const startBody = rendererSource.match(/private start\(\): void \{[^]*?\n  \}\n\}/)?.[0] ?? '';
    expect(startBody).not.toContain('selectionBox.setFromObject');
  });

  it('keeps inspector value edits out of its structural rebuild key', () => {
    expect(inspectorSource).toContain('surfaceGraphStructureKey(state.surfaceGraph)');
    expect(inspectorSource).not.toContain('JSON.stringify(layer?.pattern ?? null)');
    expect(inspectorSource).not.toContain('JSON.stringify(state.synthesis)');
    expect(inspectorSource).not.toContain('JSON.stringify(state.genomeLocks)');
    expect(inspectorSource).toContain("querySelectorAll<HTMLInputElement>('[data-synthesis-field]')");
    expect(inspectorSource).toContain("querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-graph-exposed]')");
  });

  it('commits expensive range controls on release instead of every pointer input', () => {
    expect(inspectorSource).toContain("if (target.type === 'range') return;");
    expect(inspectorSource).toContain("if (target.type === 'range') {");
    expect(inspectorSource).toContain('this.callbacks.onGraphParameter(graphExposed, value);');
    expect(inspectorSource).toContain('this.callbacks.onLayerPatch(layer.id, { pattern });');
    expect(inspectorSource).toContain("field === 'seed' && target.type === 'range' && isSimulationLayer(layer)");
    expect(inspectorSource).toContain('this.callbacks.onLayerPatch(layer.id, { seed: value });');
  });

  it('keeps the layer strip DOM stable during ordinary layer edits', () => {
    expect(layerStripSource).toContain("const nextStructureKey = state.layers.map((layer) => layer.id).join('|');");
    expect(layerStripSource).toContain('this.sync(state);');
    expect(layerStripSource).toContain('private sync(state: Readonly<ProjectState>): void');
  });

  it('yields during large CPU texture padding work', () => {
    expect(bakerSource).toContain('PIXEL_WORK_YIELD_INTERVAL');
    expect(bakerSource).toContain('await yieldToMainThread();');
  });

  it('yields during seamless normal reconstruction', () => {
    expect(seamlessSource).toContain('rebuildNormalPixelsFromHeightAsync');
    expect(seamlessSource).toContain('NORMAL_REBUILD_YIELD_ROWS');
    expect(seamlessSource).toContain('await normalizeNormalPixelsAsync(output);');
    expect(seamlessSource).toContain('await rebuildNormalFromHeight(');
  });
});
