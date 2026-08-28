import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const thumbnailSource = readFileSync(
  new URL('../src/export/PresetThumbnailRenderer.ts', import.meta.url),
  'utf8'
);
const bakerSource = readFileSync(new URL('../src/export/TextureBaker.ts', import.meta.url), 'utf8');
const seamlessSource = readFileSync(new URL('../src/export/SeamlessTexture.ts', import.meta.url), 'utf8');
const computeSource = readFileSync(new URL('../src/engine/MaterialComputeEngine.ts', import.meta.url), 'utf8');
const simulationAtlasSource = readFileSync(new URL('../src/engine/SimulationAtlas.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/engine/LabRenderer.ts', import.meta.url), 'utf8');
const meshFactorySource = readFileSync(new URL('../src/engine/MeshFactory.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
const inspectorSource = readFileSync(new URL('../src/ui/Inspector.ts', import.meta.url), 'utf8');
const layerStripSource = readFileSync(new URL('../src/ui/LayerStrip.ts', import.meta.url), 'utf8');
const canvasSource = readFileSync(new URL('../src/utils/canvas.ts', import.meta.url), 'utf8');
const tileBakerSource = readFileSync(
  new URL('../src/export/TileMaterialBaker.ts', import.meta.url),
  'utf8'
);
const terrainPanelSource = readFileSync(
  new URL('../src/ui/TerrainTileLabPanel.ts', import.meta.url),
  'utf8'
);

describe('nonblocking interactive paths', () => {
  it('uses asynchronous GPU readback for thumbnails and baked maps', () => {
    expect(thumbnailSource).toContain('readRenderTargetPixelsAsync');
    expect(thumbnailSource).not.toContain('.readRenderTargetPixels(');
    expect(bakerSource).toContain('readRenderTargetPixelsAsync');
    expect(bakerSource).not.toContain('.readRenderTargetPixels(');
  });

  it('uses bounded shader preparation for texture baking', () => {
    // Linking a many-layer portable shader is the longest step of a bake, so it must not block
    // the main thread. compileAsync alone polls COMPLETION_STATUS_KHR with no deadline, which is
    // its own hang; the poll is raced against a budget that falls back to a compile that returns.
    expect(bakerSource).toContain('const SHADER_COMPILE_POLL_BUDGET_MS =');
    expect(bakerSource).toContain('.compileAsync(context.scene, this.camera)');
    expect(bakerSource).toContain("=== 'timeout'");
    expect(bakerSource).toContain('this.renderer.compile(context.scene, this.camera);');
    // The blocking compile survives only as the bounded fallback, never on the hot path.
    expect(bakerSource).not.toContain('await this.renderer.compile(context.scene, this.camera);');
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

  it('keeps the texture baker out of the initial application chunk', () => {
    expect(tileBakerSource).toContain("await import('./TextureBaker')");
    expect(tileBakerSource).not.toMatch(/import\s*\{[^}]*TextureBaker[^}]*\}\s*from\s*['"]\.\/TextureBaker['"]/);
  });

  it('cancels the Tile Lab GPU warmup when the panel is disposed', () => {
    expect(terrainPanelSource).toContain('this.cancelPresetWarmup = scheduleIdleTask(');
    expect(terrainPanelSource).toContain('this.cancelPresetWarmup?.();');
  });

  it('does not traverse selected mesh bounds every render frame', () => {
    const startBody = rendererSource.match(/private start\(\): void \{[^]*?\n  \}\n\}/)?.[0] ?? '';
    expect(startBody).not.toContain('selectionBox.setFromObject');
  });

  it('reuses the compiled WebGPU material when only the procedural primitive changes', () => {
    expect(rendererSource).toContain('const canReuseCompiledMaterial = this.currentRoot instanceof THREE.Mesh');
    expect(rendererSource).toContain('this.currentRoot.userData.labProceduralPreview === true');
    expect(rendererSource).toContain('this.replaceRoot(mesh, new Map(), new Map(), !canReuseCompiledMaterial);');
    expect(rendererSource).toContain('if (recompileMaterial) this.sceneRevision += 1;');
  });

  it('paints shape-change progress before doing synchronous geometry work', () => {
    const start = appSource.indexOf('private async changeObjectPreset(');
    const begin = appSource.indexOf('this.progress.begin(`Changing preview shape', start);
    const paint = appSource.indexOf('await nextPaint();', begin);
    const change = appSource.indexOf('this.state.setObjectPreset(preset);', paint);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(begin).toBeGreaterThan(start);
    expect(paint).toBeGreaterThan(begin);
    expect(change).toBeGreaterThan(paint);
    expect(appSource).toContain('await this.renderer.waitForMaterialReady();');
  });

  it('keeps preview primitive tessellation bounded for interactive shape changes', () => {
    expect(meshFactorySource).toContain('const SPHERE_WIDTH_SEGMENTS = 112;');
    expect(meshFactorySource).toContain('const ICOSPHERE_DETAIL = 5;');
    expect(meshFactorySource).toContain('const CAPSULE_RADIAL_SEGMENTS = 96;');
    expect(meshFactorySource).not.toContain('const ICOSPHERE_DETAIL = 6;');
    expect(meshFactorySource).not.toContain('const CAPSULE_RADIAL_SEGMENTS = 128;');
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

  it('uses one compiled bake context for a full PBR and height bake', () => {
    expect(bakerSource).toContain("const FULL_BAKE_CHANNELS: readonly BakeChannel[] = [...PBR_CHANNELS, 'height'];");
    expect(bakerSource).toContain('private async renderChannelsSnapshot(');
    expect(bakerSource).not.toContain('const common = await this.renderPbrSnapshot');
  });

  it('reuses the readback buffer and allocates padding queue storage lazily', () => {
    expect(bakerSource).toContain('function flipRowsInPlace(');
    expect(bakerSource).toContain('new Uint8ClampedArray(source.buffer, source.byteOffset, source.byteLength)');
    expect(bakerSource).toContain('let queue: Int32Array<ArrayBuffer> | null = null;');
    expect(bakerSource).toContain('queue ??= new Int32Array(');
  });

  it('guards every frame-budget await in CPU hot paths', () => {
    for (const source of [bakerSource, seamlessSource, computeSource, simulationAtlasSource]) {
      expect(source).toContain('if (budget.isDue()) await budget.yieldIfDue();');
      expect(source).not.toMatch(/^\s*await budget\.yieldIfDue\(\);/mu);
    }
  });

  it('keeps seamless normal reconstruction chunked', () => {
    expect(seamlessSource).toContain('rebuildNormalPixelsFromHeightAsync');
    expect(seamlessSource).toContain('const budget = createFrameBudget();');
    expect(seamlessSource).toContain('await normalizeNormalPixelsAsync(output);');
    expect(seamlessSource).toContain('await rebuildNormalFromHeight(');
  });
});
