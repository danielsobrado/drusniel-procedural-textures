import '../styles/terrain-tile-lab.css';
import '../styles/terrain-player.css';
import '../styles/terrain-player-toolbar.css';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import { MATERIAL_PRESETS } from '../materials/presets';
import { TerrainGenerator } from '../tile/TerrainGenerator';
import { TerrainMeshPreview } from '../tile/TerrainMeshPreview';
import { TerrainPainter } from '../tile/TerrainPainter';
import type { TerrainPlayerState } from '../tile/TerrainPlayerController';
import {
  TerrainPresetBakeCancelled,
  TerrainPresetTextureLibrary
} from '../tile/TerrainPresetTextureLibrary';
import { TerrainSurfaceComposer, terrainTextureFromCanvas } from '../tile/TerrainSurfaceComposer';
import {
  TERRAIN_MATERIALS,
  terrainMaterialIndex,
  type TerrainBaseMaterialId,
  type TerrainExternalMaterial,
  type TerrainFields,
  type TerrainMaterialId,
  type TerrainRecipe,
  type TerrainSettings,
  type TerrainTextureSource,
  type TerrainViewMode
} from '../tile/TerrainTypes';
import { downloadBlob, downloadText } from '../utils/download';
import { escapeHtml } from '../utils/html';
import { scheduleIdleTask } from '../utils/scheduling';

interface TerrainTileLabCallbacks {
  onStatus?: (status: string) => void;
  onCurrentMaterialRequested?: () => void;
}

const BASE_MATERIAL_IDS = new Set<TerrainBaseMaterialId>(['grass', 'rock', 'mud', 'snow']);
const PRESET_OPTIONS = [...MATERIAL_PRESETS].sort((left, right) => left.name.localeCompare(right.name));

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing required terrain tile lab element: ${selector}`);
  return element;
}

function range(name: string, label: string, min: number, max: number, step: number, value: number): string {
  return `<label class="terrain-range"><span>${label}</span><input data-setting="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output data-output="${name}">${value}</output></label>`;
}

function isBaseMaterialId(value: string): value is TerrainBaseMaterialId {
  return BASE_MATERIAL_IDS.has(value as TerrainBaseMaterialId);
}

function presetOptions(materialLabel: string): string {
  return [
    `<option value="">Built-in ${escapeHtml(materialLabel)}</option>`,
    ...PRESET_OPTIONS.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`)
  ].join('');
}

function materialButtons(): string {
  return TERRAIN_MATERIALS.map((material) => {
    const button = `
      <button class="terrain-material" data-material="${material.id}" type="button">
        <span class="terrain-material-swatch" style="--terrain-swatch: rgb(${material.color.join(',')})"></span>
        <span class="terrain-material-copy">
          <strong>${escapeHtml(material.label)}</strong>
          <small data-material-source="${material.id}">${isBaseMaterialId(material.id) ? 'Built-in procedural' : 'Paint source'}</small>
        </span>
      </button>
    `;
    if (!isBaseMaterialId(material.id)) return `<div class="terrain-material-slot terrain-material-slot-simple">${button}</div>`;
    return `
      <div class="terrain-material-slot" data-material-slot="${material.id}">
        ${button}
        <label class="terrain-material-preset">
          <span>Preset</span>
          <select data-material-preset="${material.id}" aria-label="${escapeHtml(material.label)} material preset">
            ${presetOptions(material.label)}
          </select>
        </label>
        <div class="terrain-material-progress" data-material-progress="${material.id}" role="progressbar"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
          aria-label="${escapeHtml(material.label)} bake progress" hidden>
          <div class="terrain-material-progress-track">
            <div class="terrain-material-progress-bar" data-material-progress-bar="${material.id}"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function isViewMode(value: string): value is TerrainViewMode {
  return ['material', 'height', 'slope', 'flow', 'river', 'wetness', 'repeat'].includes(value);
}

function isMaterialId(value: string): value is TerrainMaterialId {
  return TERRAIN_MATERIALS.some((material) => material.id === value);
}

async function textureFromFile(file: File): Promise<TerrainTextureSource> {
  const limits = TERRAIN_CONFIG.imports;
  if (file.size > limits.maxFileBytes) {
    throw new Error(`Terrain texture exceeds the ${(limits.maxFileBytes / (1024 * 1024)).toFixed(0)} MiB file limit.`);
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > limits.maxDimension || bitmap.height > limits.maxDimension) {
      throw new Error(`Terrain texture dimensions exceed the ${limits.maxDimension}px limit.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('Could not read the imported terrain texture.');
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data.slice()
    };
  } finally {
    bitmap.close();
  }
}

export class TerrainTileLabPanel {
  private readonly generator = new TerrainGenerator();
  private readonly painter = new TerrainPainter(TERRAIN_CONFIG.resolution);
  private readonly composer = new TerrainSurfaceComposer();
  private readonly presetTextures = new TerrainPresetTextureLibrary();
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly meshCanvas: HTMLCanvasElement;
  private readonly meshPreview: TerrainMeshPreview;
  private readonly playerButton: HTMLButtonElement;
  private readonly playerButtonLabel: HTMLElement;
  private readonly viewSelect: HTMLSelectElement;
  private readonly status: HTMLElement;
  private readonly importInput: HTMLInputElement;
  private readonly paintToggle: HTMLInputElement;
  private readonly eraseToggle: HTMLInputElement;
  private readonly brushRadius: HTMLInputElement;
  private readonly brushHardness: HTMLInputElement;
  private readonly brushStrength: HTMLInputElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly presetAssignments: Partial<Record<TerrainBaseMaterialId, string>> = {};
  private readonly presetLoadSequences: Partial<Record<TerrainBaseMaterialId, number>> = {};
  private fields: TerrainFields | null = null;
  private settings: TerrainSettings;
  private selectedMaterial: TerrainMaterialId = 'grass';
  private viewMode: TerrainViewMode = 'material';
  private previewMode: '2d' | '3d' = '2d';
  private generationSequence = 0;
  private generationAbort: AbortController | null = null;
  private textureImportSequence = 0;
  private renderFrame = 0;
  private surfaceFrame = 0;
  private drawingPointer: number | null = null;
  private drawingErase = false;
  private lastStroke: { x: number; y: number } | null = null;
  private importedTextureName: string | null = null;
  private hasCurrentMaterialTexture = false;
  private cancelPresetWarmup: (() => void) | null = null;

  public constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: Readonly<TerrainTileLabCallbacks> = {}
  ) {
    const config = TERRAIN_CONFIG;
    this.settings = {
      seed: 42,
      mountainCoverage: config.mountains.coverage,
      mountainHeight: config.mountains.height,
      ridgeSharpness: config.mountains.ridgeSharpness,
      detail: config.mountains.detail,
      riverDensity: config.hydrology.riverDensity,
      riverDepth: config.hydrology.riverDepth,
      wetnessRadius: config.hydrology.wetnessRadius,
      materialRepeat: config.materialRepeat
    };

    this.root.innerHTML = `
      <div class="terrain-lab-grid">
        <aside class="terrain-panel terrain-generator-panel">
          <div class="terrain-panel-heading"><span class="eyebrow">Generator</span><strong>World shape</strong></div>
          <label class="terrain-seed"><span>Seed</span><input data-role="terrain-seed" type="number" min="0" max="4294967295" value="${this.settings.seed}"><button data-role="terrain-random-seed" type="button">↻</button></label>
          ${range('mountainCoverage', 'Mountain coverage', 0.05, 1, 0.01, this.settings.mountainCoverage)}
          ${range('mountainHeight', 'Mountain height', 0.1, 1.4, 0.01, this.settings.mountainHeight)}
          ${range('ridgeSharpness', 'Ridge sharpness', 0.6, 6, 0.05, this.settings.ridgeSharpness)}
          ${range('detail', 'Micro detail', 0, 1, 0.01, this.settings.detail)}
          <div class="terrain-panel-heading terrain-subheading"><span class="eyebrow">Hydrology</span><strong>Rivers</strong></div>
          ${range('riverDensity', 'River density', 0, 1, 0.01, this.settings.riverDensity)}
          ${range('riverDepth', 'Channel depth', 0, 0.18, 0.002, this.settings.riverDepth)}
          <button class="compact-button terrain-primary" data-role="terrain-generate" type="button">Generate terrain</button>
        </aside>

        <section class="terrain-stage">
          <div class="terrain-stage-toolbar">
            <div class="terrain-view-switch">
              <button class="is-active" data-preview="2d" type="button">2D map</button>
              <button data-preview="3d" type="button">3D terrain</button>
            </div>
            <button class="terrain-player-toolbar-button" data-role="terrain-player" type="button" aria-pressed="false" title="Choose a spawn point and walk the seamless terrain">
              <span aria-hidden="true">◎</span>
              <span data-role="terrain-player-label">Player</span>
            </button>
            <label><span>View</span><select data-role="terrain-view">
              <option value="material">Material</option><option value="height">Height</option><option value="slope">Slope</option>
              <option value="flow">Flow</option><option value="river">Rivers</option><option value="wetness">Wetness</option><option value="repeat">3 × 3 material</option>
            </select></label>
            <span class="terrain-backend" data-role="terrain-backend">Preparing…</span>
          </div>
          <div class="terrain-canvas-stack">
            <canvas data-role="terrain-map" aria-label="Procedural terrain map"></canvas>
            <canvas data-role="terrain-mesh" aria-label="3D procedural terrain preview" hidden></canvas>
            <div class="terrain-status" data-role="terrain-status">Generating tileable mountains and rivers…</div>
          </div>
        </section>

        <aside class="terrain-panel terrain-material-panel">
          <div class="terrain-panel-heading"><span class="eyebrow">Materials</span><strong>Paint terrain</strong></div>
          <div class="terrain-material-list">${materialButtons()}</div>
          <p class="terrain-material-note">Grass, rock, mud and snow can each use any Material Preset without changing the main PTL material.</p>
          <label class="terrain-toggle"><input data-role="terrain-paint-enabled" type="checkbox" checked><span>Paint material overrides</span></label>
          <label class="terrain-toggle"><input data-role="terrain-erase" type="checkbox"><span>Erase overrides</span></label>
          ${range('brushRadius', 'Brush size', 0.005, 0.16, 0.0025, config.painting.radius)}
          ${range('brushHardness', 'Hardness', 0, 1, 0.01, config.painting.hardness)}
          ${range('brushStrength', 'Strength', 0.05, 1, 0.01, config.painting.strength)}
          ${range('materialRepeat', 'Texture scale', 2, 96, 1, this.settings.materialRepeat)}
          <div class="terrain-import-row"><button class="compact-button" data-role="terrain-import" type="button">Import tile texture</button><button class="compact-button" data-role="terrain-clear-paint" type="button">Clear paint</button></div>
          <input data-role="terrain-import-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <div class="terrain-export-row"><button class="compact-button" data-role="terrain-export-height" type="button">Export height</button><button class="compact-button" data-role="terrain-export-recipe" type="button">Export PTL map</button></div>
          <p class="terrain-help">Auto masks use height, slope and river wetness. Manual paint is stored as resolution-independent strokes and wraps across tile edges.</p>
        </aside>
      </div>
    `;

    this.mapCanvas = required(this.root, '[data-role="terrain-map"]');
    this.meshCanvas = required(this.root, '[data-role="terrain-mesh"]');
    this.playerButton = required(this.root, '[data-role="terrain-player"]');
    this.playerButtonLabel = required(this.root, '[data-role="terrain-player-label"]');
    this.viewSelect = required(this.root, '[data-role="terrain-view"]');
    this.status = required(this.root, '[data-role="terrain-status"]');
    this.importInput = required(this.root, '[data-role="terrain-import-input"]');
    this.paintToggle = required(this.root, '[data-role="terrain-paint-enabled"]');
    this.eraseToggle = required(this.root, '[data-role="terrain-erase"]');
    this.brushRadius = required(this.root, '[data-setting="brushRadius"]');
    this.brushHardness = required(this.root, '[data-setting="brushHardness"]');
    this.brushStrength = required(this.root, '[data-setting="brushStrength"]');
    this.meshPreview = new TerrainMeshPreview(this.meshCanvas, {
      onPlayerStateChange: (state) => this.syncPlayerButton(state),
      onPlayerStatus: (message) => this.setStatus(message)
    });
    this.bindControls();
    this.bindPainting();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(this.mapCanvas);
    this.selectMaterial(this.selectedMaterial);
    this.syncPlayerButton('idle');
    // Building the bake context costs a WebGL2 context creation. Doing it while the terrain
    // generates keeps it off the critical path of the first preset change.
    this.cancelPresetWarmup = scheduleIdleTask(() => {
      this.cancelPresetWarmup = null;
      this.presetTextures.warm();
    });
    void this.generate();
  }

  public setCurrentMaterialTexture(source: HTMLCanvasElement): void {
    const texture = terrainTextureFromCanvas(source);
    if (texture === null) {
      this.composer.setTexture(terrainMaterialIndex('current'), null);
      this.hasCurrentMaterialTexture = false;
      this.setCurrentMaterialError('Could not read the baked texture.');
      return;
    }
    this.composer.setTexture(terrainMaterialIndex('current'), texture);
    this.hasCurrentMaterialTexture = true;
    if (this.selectedMaterial === 'current') this.setStatus('Current PTL material is ready for terrain painting.');
    this.scheduleRender();
    this.refreshSurface();
  }

  public clearCurrentMaterialTexture(): void {
    if (!this.hasCurrentMaterialTexture) return;
    this.composer.setTexture(terrainMaterialIndex('current'), null);
    this.hasCurrentMaterialTexture = false;
    if (this.selectedMaterial === 'current') {
      this.setStatus('Current PTL material changed · click Current PTL to refresh it.');
    }
    this.scheduleRender();
    this.refreshSurface();
  }

  public setCurrentMaterialError(message: string): void {
    if (this.selectedMaterial !== 'current' || this.hasCurrentMaterialTexture) return;
    this.setStatus(`Current PTL material unavailable · ${message}`);
  }

  public dispose(): void {
    this.generationSequence += 1;
    this.generationAbort?.abort();
    this.generationAbort = null;
    this.textureImportSequence += 1;
    for (const material of BASE_MATERIAL_IDS) {
      this.presetLoadSequences[material] = (this.presetLoadSequences[material] ?? 0) + 1;
    }
    if (this.renderFrame !== 0) cancelAnimationFrame(this.renderFrame);
    if (this.surfaceFrame !== 0) cancelAnimationFrame(this.surfaceFrame);
    this.cancelPresetWarmup?.();
    this.cancelPresetWarmup = null;
    this.resizeObserver.disconnect();
    this.presetTextures.clear();
    this.meshPreview.dispose();
  }

  private bindControls(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      input.addEventListener('input', () => {
        const output = this.root.querySelector<HTMLOutputElement>(`[data-output="${input.dataset.setting ?? ''}"]`);
        if (output !== null) output.value = input.value;
        if (input.dataset.setting === 'materialRepeat') {
          this.settings.materialRepeat = Number.parseFloat(input.value);
          this.scheduleRender();
          this.refreshSurface();
        }
      });
    }
    required<HTMLButtonElement>(this.root, '[data-role="terrain-generate"]').addEventListener('click', () => { void this.generate(); });
    required<HTMLButtonElement>(this.root, '[data-role="terrain-random-seed"]').addEventListener('click', () => {
      const seed = required<HTMLInputElement>(this.root, '[data-role="terrain-seed"]');
      seed.value = String(Math.floor(Math.random() * 0xffffffff));
      void this.generate();
    });
    this.playerButton.addEventListener('click', () => this.togglePlayerMode());
    this.viewSelect.addEventListener('change', () => {
      if (!isViewMode(this.viewSelect.value)) return;
      this.viewMode = this.viewSelect.value;
      this.scheduleRender();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-preview]')) {
      button.addEventListener('click', () => this.setPreviewMode(button.dataset.preview === '3d' ? '3d' : '2d'));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-material]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.material ?? '';
        if (isMaterialId(id)) this.selectMaterial(id);
      });
    }
    for (const select of this.root.querySelectorAll<HTMLSelectElement>('[data-material-preset]')) {
      select.addEventListener('change', () => {
        const material = select.dataset.materialPreset ?? '';
        if (isBaseMaterialId(material)) void this.assignMaterialPreset(material, select.value);
      });
    }
    required<HTMLButtonElement>(this.root, '[data-role="terrain-import"]').addEventListener('click', () => this.importInput.click());
    this.importInput.addEventListener('change', () => {
      const file = this.importInput.files?.[0];
      if (file !== undefined) void this.importTexture(file);
      this.importInput.value = '';
    });
    required<HTMLButtonElement>(this.root, '[data-role="terrain-clear-paint"]').addEventListener('click', () => {
      this.painter.clear();
      this.scheduleRender();
      this.refreshSurface();
    });
    required<HTMLButtonElement>(this.root, '[data-role="terrain-export-height"]').addEventListener('click', () => { void this.exportHeight(); });
    required<HTMLButtonElement>(this.root, '[data-role="terrain-export-recipe"]').addEventListener('click', () => this.exportRecipe());
  }

  private bindPainting(): void {
    this.mapCanvas.addEventListener('contextmenu', (event) => {
      if (this.canPaint()) event.preventDefault();
    });
    this.mapCanvas.addEventListener('pointerdown', (event) => {
      if (!this.canPaint()) return;
      if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      this.drawingPointer = event.pointerId;
      this.drawingErase = this.eraseToggle.checked || event.button === 2;
      this.mapCanvas.setPointerCapture(event.pointerId);
      this.lastStroke = null;
      this.paintAt(event);
    });
    this.mapCanvas.addEventListener('pointermove', (event) => {
      if (this.drawingPointer !== event.pointerId || !this.canPaint()) return;
      this.paintAt(event);
    });
    const finish = (event: PointerEvent): void => {
      if (this.drawingPointer !== event.pointerId) return;
      this.drawingPointer = null;
      this.drawingErase = false;
      this.lastStroke = null;
      this.refreshSurface();
    };
    this.mapCanvas.addEventListener('pointerup', finish);
    this.mapCanvas.addEventListener('pointercancel', finish);
  }

  private async assignMaterialPreset(material: TerrainBaseMaterialId, presetId: string): Promise<void> {
    const sequence = (this.presetLoadSequences[material] ?? 0) + 1;
    this.presetLoadSequences[material] = sequence;
    const selector = required<HTMLSelectElement>(this.root, `[data-material-preset="${material}"]`);
    const slot = required<HTMLElement>(this.root, `[data-material-slot="${material}"]`);
    const sourceLabel = required<HTMLElement>(this.root, `[data-material-source="${material}"]`);
    const previousPresetId = this.presetAssignments[material] ?? '';
    const materialLabel = TERRAIN_MATERIALS.find((entry) => entry.id === material)?.label ?? material;

    this.selectMaterial(material);
    if (presetId === '') {
      delete this.presetAssignments[material];
      this.composer.setTexture(terrainMaterialIndex(material), null);
      sourceLabel.textContent = 'Built-in procedural';
      slot.classList.remove('is-loading');
      selector.disabled = false;
      this.setStatus(`${materialLabel} restored to the built-in procedural material.`);
      this.scheduleRender();
      this.refreshSurface();
      return;
    }

    const preset = MATERIAL_PRESETS.find((candidate) => candidate.id === presetId);
    if (preset === undefined) {
      selector.value = previousPresetId;
      this.setStatus(`Unknown material preset: ${presetId}.`);
      return;
    }

    selector.disabled = true;
    slot.classList.add('is-loading');
    const progress = this.materialProgress(material);
    progress.show();
    sourceLabel.textContent = `Baking ${preset.name}…`;
    this.setStatus(`Baking ${preset.name} for ${materialLabel.toLowerCase()} terrain…`);
    try {
      const texture = await this.presetTextures.load(preset.id, {
        isCurrent: () => sequence === this.presetLoadSequences[material],
        onProgress: (phase, fraction) => {
          if (sequence !== this.presetLoadSequences[material]) return;
          progress.set(fraction);
          sourceLabel.textContent = `${preset.name} · ${phase}`;
          this.setStatus(
            `${preset.name} → ${materialLabel.toLowerCase()} · ${phase} ${Math.round(fraction * 100)}%`
          );
        }
      });
      if (sequence !== this.presetLoadSequences[material]) return;
      this.composer.setTexture(terrainMaterialIndex(material), texture);
      this.presetAssignments[material] = preset.id;
      sourceLabel.textContent = preset.name;
      this.setStatus(`${materialLabel} now uses ${preset.name}.`);
      this.scheduleRender();
      this.refreshSurface();
    } catch (error) {
      if (sequence !== this.presetLoadSequences[material]) return;
      if (error instanceof TerrainPresetBakeCancelled) return;
      console.error(`Terrain material preset bake failed for ${preset.id}.`, error);
      selector.value = previousPresetId;
      sourceLabel.textContent = previousPresetId === ''
        ? 'Built-in procedural'
        : MATERIAL_PRESETS.find((candidate) => candidate.id === previousPresetId)?.name ?? 'Material preset';
      this.setStatus(error instanceof Error ? error.message : `Could not bake ${preset.name}.`);
    } finally {
      if (sequence === this.presetLoadSequences[material]) {
        selector.disabled = false;
        slot.classList.remove('is-loading');
        this.materialProgress(material).hide();
      }
    }
  }

  private materialProgress(material: TerrainBaseMaterialId): {
    show: () => void;
    set: (fraction: number) => void;
    hide: () => void;
  } {
    const host = required<HTMLElement>(this.root, `[data-material-progress="${material}"]`);
    const bar = required<HTMLElement>(this.root, `[data-material-progress-bar="${material}"]`);
    const set = (fraction: number): void => {
      const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
      host.setAttribute('aria-valuenow', String(percent));
      bar.style.width = `${percent}%`;
    };
    return {
      show: () => {
        set(0);
        host.hidden = false;
      },
      set,
      hide: () => {
        host.hidden = true;
      }
    };
  }

  private async generate(): Promise<void> {
    const sequence = ++this.generationSequence;
    this.generationAbort?.abort();
    const abort = new AbortController();
    this.generationAbort = abort;
    this.readGenerationSettings();
    const settings = { ...this.settings };
    this.setStatus('Generating tileable mountains, drainage and material masks…');
    try {
      const fields = await this.generator.generate(
        settings,
        undefined,
        (phase, fraction) => {
          if (sequence === this.generationSequence) {
            this.setStatus(`${phase}… ${Math.round(fraction * 100)}%`);
          }
        },
        abort.signal
      );
      if (sequence !== this.generationSequence) return;
      this.fields = fields;
      this.painter.resize(fields.resolution);
      const riverCoverage = fields.river.reduce((sum, value) => sum + (value > 0.15 ? 1 : 0), 0) / fields.river.length * 100;
      required<HTMLElement>(this.root, '[data-role="terrain-backend"]').textContent = fields.backend === 'webgpu' ? 'WebGPU compute' : 'CPU fallback';
      this.setStatus(`${fields.resolution}² · ${riverCoverage.toFixed(1)}% river network · seamless periodic domain`);
      this.scheduleRender();
      this.refreshSurface();
    } catch (error) {
      if (sequence !== this.generationSequence) return;
      console.error('Terrain generation failed.', error);
      this.setStatus(error instanceof Error ? error.message : 'Terrain generation failed.');
    } finally {
      if (this.generationAbort === abort) this.generationAbort = null;
    }
  }

  private readGenerationSettings(): void {
    const seed = Number.parseInt(required<HTMLInputElement>(this.root, '[data-role="terrain-seed"]').value, 10);
    this.settings.seed = Number.isFinite(seed) ? seed >>> 0 : 42;
    for (const key of ['mountainCoverage', 'mountainHeight', 'ridgeSharpness', 'detail', 'riverDensity', 'riverDepth'] as const) {
      const value = Number.parseFloat(required<HTMLInputElement>(this.root, `[data-setting="${key}"]`).value);
      if (Number.isFinite(value)) this.settings[key] = value;
    }
  }

  private paintAt(event: PointerEvent): void {
    const bounds = this.mapCanvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const radius = Number.parseFloat(this.brushRadius.value);
    const hardness = Number.parseFloat(this.brushHardness.value);
    const strength = Number.parseFloat(this.brushStrength.value);
    if (![x, y, radius, hardness, strength].every(Number.isFinite)) return;

    if (this.lastStroke === null) {
      this.painter.paint(this.selectedMaterial, x, y, radius, hardness, strength, this.drawingErase);
    } else {
      this.painter.paintLine(
        this.selectedMaterial,
        this.lastStroke.x,
        this.lastStroke.y,
        x,
        y,
        radius,
        hardness,
        strength,
        this.drawingErase
      );
    }
    this.lastStroke = { x, y };
    this.scheduleRender();
  }

  private canPaint(): boolean {
    return this.fields !== null && this.previewMode === '2d' && this.viewMode === 'material' && this.paintToggle.checked;
  }

  private selectMaterial(material: TerrainMaterialId): void {
    this.selectedMaterial = material;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-material]')) {
      button.classList.toggle('is-active', button.dataset.material === material);
    }
    if (material === 'current' && !this.hasCurrentMaterialTexture) {
      this.setStatus('Baking current PTL material for terrain painting…');
      this.callbacks.onCurrentMaterialRequested?.();
    }
    if (this.viewMode === 'repeat') this.scheduleRender();
  }

  private togglePlayerMode(): void {
    if (this.meshPreview.playerState !== 'idle') {
      this.meshPreview.exitPlayerMode();
      return;
    }
    if (this.fields === null) {
      this.setStatus('Generate terrain before entering player mode.');
      return;
    }

    this.setPreviewMode('3d');
    if (!this.meshPreview.startPlayerPlacement()) {
      this.setStatus('Player mode is not ready yet. Generate terrain and try again.');
    }
  }

  private syncPlayerButton(state: TerrainPlayerState): void {
    const active = state !== 'idle';
    this.playerButton.classList.toggle('is-active', active);
    this.playerButton.setAttribute('aria-pressed', String(active));
    this.playerButtonLabel.textContent = state === 'placing'
      ? 'Pick spawn'
      : active
        ? 'Exit player'
        : 'Player';
  }

  private setPreviewMode(mode: '2d' | '3d'): void {
    if (mode === '2d' && this.meshPreview.playerState !== 'idle') {
      this.meshPreview.exitPlayerMode();
    }
    this.previewMode = mode;
    this.mapCanvas.hidden = mode !== '2d';
    this.meshCanvas.hidden = mode !== '3d';
    this.viewSelect.disabled = mode === '3d';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-preview]')) {
      button.classList.toggle('is-active', button.dataset.preview === mode);
    }
    if (mode === '3d') this.refreshSurface();
    else this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderFrame !== 0) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      if (this.previewMode !== '2d') return;
      if (this.viewMode === 'repeat') {
        this.composer.renderMaterialRepeatPreview(
          this.mapCanvas,
          terrainMaterialIndex(this.selectedMaterial)
        );
        return;
      }
      if (this.fields !== null) {
        this.composer.renderPreview(
          this.mapCanvas,
          this.fields,
          this.painter.mask,
          this.viewMode,
          this.settings.materialRepeat
        );
      }
    });
  }

  /**
   * Coalesced to one frame: in 3D mode this rebuilds a 384x384 material canvas, i.e. a
   * ~147k-pixel loop, and it used to run synchronously on every slider input event.
   */
  private refreshSurface(): void {
    if (this.fields === null) return;
    if (this.previewMode !== '3d') {
      this.scheduleRender();
      return;
    }
    if (this.surfaceFrame !== 0) return;
    this.surfaceFrame = requestAnimationFrame(() => {
      this.surfaceFrame = 0;
      this.rebuildSurface();
    });
  }

  private rebuildSurface(): void {
    if (this.fields === null || this.previewMode !== '3d') return;
    const surface = this.composer.createMaterialCanvas(
      this.fields,
      this.painter.mask,
      this.settings.materialRepeat,
      384,
      false
    );
    this.meshPreview.update(this.fields, surface);
  }

  private async importTexture(file: File): Promise<void> {
    const sequence = ++this.textureImportSequence;
    try {
      const texture = await textureFromFile(file);
      if (sequence !== this.textureImportSequence) return;
      this.composer.setTexture(terrainMaterialIndex('custom'), texture);
      this.importedTextureName = file.name;
      this.selectMaterial('custom');
      this.setStatus(`Imported ${file.name} as a repeating paint material.`);
      this.scheduleRender();
      this.refreshSurface();
    } catch (error) {
      if (sequence !== this.textureImportSequence) return;
      console.error('Terrain texture import failed.', error);
      this.setStatus(error instanceof Error ? error.message : 'Terrain texture import failed.');
    }
  }

  private async exportHeight(): Promise<void> {
    const fields = this.fields;
    if (fields === null) return;

    try {
      const rawBuffer = new ArrayBuffer(fields.height.length * Uint16Array.BYTES_PER_ELEMENT);
      const rawView = new DataView(rawBuffer);
      for (let index = 0; index < fields.height.length; index += 1) {
        const value = Math.max(0, Math.min(65535, Math.round((fields.height[index] ?? 0) * 65535)));
        rawView.setUint16(index * Uint16Array.BYTES_PER_ELEMENT, value, true);
      }
      downloadBlob('procedural-terrain-height.r16', new Blob([rawBuffer], { type: 'application/octet-stream' }));

      const canvas = document.createElement('canvas');
      canvas.width = fields.resolution;
      canvas.height = fields.resolution;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Could not create terrain height preview.');
      const image = context.createImageData(fields.resolution, fields.resolution);
      for (let index = 0; index < fields.height.length; index += 1) {
        const value = Math.max(0, Math.min(255, Math.round((fields.height[index] ?? 0) * 255)));
        const target = index * 4;
        image.data[target] = value;
        image.data[target + 1] = value;
        image.data[target + 2] = value;
        image.data[target + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value === null ? reject(new Error('Heightmap preview encoding failed.')) : resolve(value),
        'image/png'
      ));
      downloadBlob('procedural-terrain-height-preview.png', blob);
      this.setStatus('Exported 16-bit R16 heightmap and PNG preview.');
    } catch (error) {
      console.error('Terrain height export failed.', error);
      this.setStatus(error instanceof Error ? error.message : 'Terrain height export failed.');
    }
  }

  private exportRecipe(): void {
    const usedMaterials = new Set(this.painter.strokes.filter((stroke) => !stroke.erase).map((stroke) => stroke.material));
    const externalMaterials: TerrainExternalMaterial[] = [];
    if (usedMaterials.has('current')) {
      externalMaterials.push({ id: 'current', source: 'current-ptl', name: null });
    }
    if (usedMaterials.has('custom')) {
      externalMaterials.push({ id: 'custom', source: 'image', name: this.importedTextureName });
    }
    const recipe: TerrainRecipe = {
      version: 1,
      kind: 'ptl-terrain',
      tileable: true,
      resolution: this.fields?.resolution ?? TERRAIN_CONFIG.resolution,
      worldSize: TERRAIN_CONFIG.worldSize,
      heightScale: TERRAIN_CONFIG.heightScale,
      settings: { ...this.settings },
      strokes: this.painter.strokes.map((stroke) => ({ ...stroke })),
      materialPresets: { ...this.presetAssignments },
      externalMaterials
    };
    downloadText('procedural-terrain.ptlmap.json', JSON.stringify(recipe, null, 2));
    if (externalMaterials.some((material) => material.name === null)) {
      this.setStatus('PTL map exported; unresolved external paint materials must be supplied by the host.');
    } else {
      this.setStatus('PTL map recipe exported with terrain material preset assignments.');
    }
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
    this.callbacks.onStatus?.(message);
  }
}
