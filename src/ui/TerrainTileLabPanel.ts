import '../styles/terrain-tile-lab.css';
import '../styles/terrain-player.css';
import '../styles/terrain-player-toolbar.css';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { BakedTextureSet } from '../export/TextureBaker';
import { MATERIAL_PRESETS } from '../materials/presets';
import { TerrainGenerator } from '../tile/TerrainGenerator';
import { TerrainMeshPreview } from '../tile/TerrainMeshPreview';
import {
  isTerrainLightingPresetId,
  TERRAIN_LIGHTING_PRESETS
} from '../tile/TerrainSkyLighting';
import { TerrainPainter } from '../tile/TerrainPainter';
import type { TerrainPlayerState } from '../tile/TerrainPlayerController';
import {
  TerrainPresetBakeCancelled,
  TerrainPresetTextureLibrary
} from '../tile/TerrainPresetTextureLibrary';
import { terrainPbrTexturesFromBaked } from '../tile/TerrainPbrAtlas';
import {
  clampMetersPerTile,
  formatMetersPerTile,
  metersPerTile,
  repeatForMeters
} from '../tile/TerrainScale';
import { TerrainSurfaceComposer } from '../tile/TerrainSurfaceComposer';
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
import { cachedPresetTint, loadPresetTint } from './presetTint';
import { MaterialRadialMenu } from './MaterialRadialMenu';
import { UI_CONFIG } from '../app/constants';
import { presetThumbnailUrl } from '../assets/PresetAssets';
import { sampleTerrainMaterialAt } from '../tile/TerrainSurfaceProbe';
import { TouchRadialTrigger } from './TouchRadialTrigger';

interface TerrainTileLabCallbacks {
  onStatus?: (status: string) => void;
  onCurrentMaterialRequested?: () => void;
}

const BASE_MATERIAL_IDS = new Set<TerrainBaseMaterialId>(['grass', 'rock', 'mud', 'snow']);
/**
 * The 2D map is a 256-texel schematic of a 512 m world, so it cannot represent a 4 m
 * texture tile: point-sampling at the true repeat is pure aliasing. The diagnostic view
 * caps the repeat it draws with; the 3D preview always uses the real scale.
 */
const MAP_PREVIEW_MAX_REPEAT = 24;
const PRESET_OPTIONS = [...MATERIAL_PRESETS].sort((left, right) => left.name.localeCompare(right.name));

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing required terrain tile lab element: ${selector}`);
  return element;
}

function range(name: string, label: string, min: number, max: number, step: number, value: number): string {
  return `<label class="terrain-range"><span>${label}</span><input data-setting="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output data-output="${name}">${value}</output></label>`;
}

/**
 * Texture scale is authored logarithmically in metres per tile. Metres because that is
 * what an artist reasons about, logarithmic because a linear 0.5-64 m range spends most
 * of its travel in sizes nobody uses.
 */
function scaleRange(meters: number): string {
  const { minMetersPerTextureTile, maxMetersPerTextureTile } = TERRAIN_CONFIG.scale;
  const min = Math.log2(minMetersPerTextureTile).toFixed(3);
  const max = Math.log2(maxMetersPerTextureTile).toFixed(3);
  const value = Math.log2(meters).toFixed(3);
  return `<label class="terrain-range terrain-range-wide"><span>Texture scale</span>` +
    `<input data-setting="materialScale" type="range" min="${min}" max="${max}" step="0.02" value="${value}">` +
    `<output data-output="materialScale">${scaleReadout(meters)}</output></label>`;
}

function scaleReadout(meters: number): string {
  return `${formatMetersPerTile(meters)} m/tile · repeat ${Math.round(repeatForMeters(meters))}`;
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

function materialButtons(globalMeters: number): string {
  const { minMetersPerTextureTile, maxMetersPerTextureTile } = TERRAIN_CONFIG.scale;
  const min = Math.log2(minMetersPerTextureTile).toFixed(3);
  const max = Math.log2(maxMetersPerTextureTile).toFixed(3);
  const value = Math.log2(globalMeters).toFixed(3);
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
      <div class="terrain-material-slot" data-material-slot="${material.id}" role="group"
        aria-label="${escapeHtml(material.label)} material">
        <div class="terrain-material-row">
          <button class="terrain-material-thumb" type="button" data-material-radial="${material.id}"
            data-material-thumb="${material.id}"
            aria-label="Choose a preset for ${escapeHtml(material.label)}"
            title="Choose a preset for ${escapeHtml(material.label)}"></button>
          ${button}
        </div>
        <button class="terrain-material-compare" type="button" data-material-compare="${material.id}"
          title="Flip between this preset and the previous one" hidden>A | B</button>
        <label class="terrain-material-preset">
          <span>Preset</span>
          <select data-material-preset="${material.id}" aria-label="${escapeHtml(material.label)} material preset">
            ${presetOptions(material.label)}
          </select>
        </label>
        <div class="terrain-material-scale" data-material-scale-controls="${material.id}">
          <label class="terrain-material-scale-link">
            <input type="checkbox" data-material-scale-linked="${material.id}" checked>
            <span>Use global scale</span>
          </label>
          <label class="terrain-material-scale-slider">
            <span>Metres per tile</span>
            <input type="range" data-material-scale="${material.id}" min="${min}" max="${max}"
              step="0.02" value="${value}" disabled aria-label="${escapeHtml(material.label)} metres per tile">
            <output data-material-scale-output="${material.id}">${scaleReadout(globalMeters)}</output>
          </label>
        </div>
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

function lightingOptions(active: string): string {
  return TERRAIN_LIGHTING_PRESETS.map((preset) => {
    const selected = preset.id === active ? ' selected' : '';
    return `<option value="${escapeHtml(preset.id)}"${selected}>${escapeHtml(preset.label)}</option>`;
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
  private readonly radial: MaterialRadialMenu;
  private readonly touchRadialTriggers: TouchRadialTrigger[] = [];
  private radialMaterial: TerrainBaseMaterialId = 'grass';
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly mapMarker: HTMLElement;
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
  private radialPreviewSequence = 0;
  private paintRevision = 0;
  private drawingPointer: number | null = null;
  private drawingErase = false;
  private pendingStroke: {
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    clientX: number;
    clientY: number;
  } | null = null;
  private lastStroke: { x: number; y: number } | null = null;
  private importedTextureName: string | null = null;
  private hasCurrentMaterialTexture = false;

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
            <button class="terrain-player-toolbar-button" data-role="terrain-inspect" type="button"
              title="Focus the visible surface at human scale">Inspect</button>
            <label><span>View</span><select data-role="terrain-view">
              <option value="material">Material</option><option value="height">Height</option><option value="slope">Slope</option>
              <option value="flow">Flow</option><option value="river">Rivers</option><option value="wetness">Wetness</option><option value="repeat">3 × 3 material</option>
            </select></label>
            <label><span>Light</span><select data-role="terrain-lighting">${lightingOptions(TERRAIN_CONFIG.lighting.preset)}</select></label>
            <label class="terrain-sun"><span>Sun</span><input data-role="terrain-sun" type="range" min="-5" max="89" step="1" value="${Math.round(TERRAIN_CONFIG.lighting.sunElevationDegrees)}"><output data-output="terrain-sun">${Math.round(TERRAIN_CONFIG.lighting.sunElevationDegrees)}°</output></label>
            <span class="terrain-backend" data-role="terrain-backend">Preparing…</span>
          </div>
          <div class="terrain-canvas-stack">
            <canvas data-role="terrain-map" aria-label="Procedural terrain map"></canvas>
            <span class="terrain-map-marker" data-role="terrain-map-marker" aria-hidden="true" hidden></span>
            <canvas data-role="terrain-mesh" aria-label="3D procedural terrain preview" hidden></canvas>
            <div class="terrain-status" data-role="terrain-status">Generating tileable mountains and rivers…</div>
          </div>
        </section>

        <aside class="terrain-panel terrain-material-panel">
          <div class="terrain-panel-heading"><span class="eyebrow">Materials</span><strong>Paint terrain</strong></div>
          <div class="terrain-material-list">${materialButtons(metersPerTile(this.settings.materialRepeat))}</div>
          <p class="terrain-material-note">Grass, rock, mud and snow can each use any Material Preset without changing the main PTL material.</p>
          <label class="terrain-toggle"><input data-role="terrain-paint-enabled" type="checkbox" checked><span>Paint material overrides</span></label>
          <label class="terrain-toggle"><input data-role="terrain-erase" type="checkbox"><span>Erase overrides</span></label>
          <label class="terrain-toggle"><input data-role="terrain-props" type="checkbox" checked><span>Rocks, plants & houses</span></label>
          <label class="terrain-toggle"><input data-role="terrain-scale-ref" type="checkbox"><span>Scale reference (1.75 m figure)</span></label>
          ${range('propDensity', 'Prop density', 0, 3, 0.25, 1)}
          ${range('brushRadius', 'Brush size', 0.005, 0.16, 0.0025, config.painting.radius)}
          ${range('brushHardness', 'Hardness', 0, 1, 0.01, config.painting.hardness)}
          ${range('brushStrength', 'Strength', 0.05, 1, 0.01, config.painting.strength)}
          ${scaleRange(metersPerTile(this.settings.materialRepeat))}
          <p class="terrain-help terrain-scale-note">One texture tile covers this much ground. Game terrain reads best at 1-4 m; the repetition you see at that scale is what ships.</p>
          <div class="terrain-import-row"><button class="compact-button" data-role="terrain-import" type="button">Import tile texture</button><button class="compact-button" data-role="terrain-clear-paint" type="button">Clear paint</button></div>
          <input data-role="terrain-import-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <div class="terrain-export-row"><button class="compact-button" data-role="terrain-export-height" type="button">Export height</button><button class="compact-button" data-role="terrain-export-recipe" type="button">Export PTL map</button></div>
          <p class="terrain-help">Seeded CC0 rocks and plants plus two simple houses reuse the assigned materials at real-world scale. Toggle them off for an unobstructed terrain pass.</p>
        </aside>
      </div>
    `;

    this.mapCanvas = required(this.root, '[data-role="terrain-map"]');
    this.mapMarker = required(this.root, '[data-role="terrain-map-marker"]');
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
      onPlayerStatus: (message) => this.setStatus(message),
      onPlayerNavigationChange: () => this.drawMapMarker()
    });
    this.radial = new MaterialRadialMenu({
      onHover: (presetId) => { void this.previewPreset(presetId); },
      onCommit: (presetId) => this.commitPreset(presetId),
      onCancel: () => this.cancelRadialPreview()
    });
    this.bindControls();
    this.bindPainting();
    this.bindRadial();
    this.bindTouchRadial();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(this.mapCanvas);
    this.selectMaterial(this.selectedMaterial);
    this.syncMaterialInfo();
    this.syncPlayerButton('idle');
    void this.generate();
  }

  public setCurrentMaterialTextures(source: Readonly<BakedTextureSet>): void {
    const textures = terrainPbrTexturesFromBaked(source);
    if (textures === null) {
      this.composer.setTextures(terrainMaterialIndex('current'), null);
      this.meshPreview.setMaterialTextures(terrainMaterialIndex('current'), null);
      this.hasCurrentMaterialTexture = false;
      this.setCurrentMaterialError('Could not read the baked PBR textures.');
      return;
    }
    this.composer.setTextures(terrainMaterialIndex('current'), textures);
    this.meshPreview.setMaterialTextures(terrainMaterialIndex('current'), textures);
    this.hasCurrentMaterialTexture = true;
    if (this.selectedMaterial === 'current') this.setStatus('Current PTL material is ready for terrain painting.');
    this.scheduleRender();
    this.refreshSurface();
  }

  public clearCurrentMaterialTexture(): void {
    if (!this.hasCurrentMaterialTexture) return;
    this.composer.setTextures(terrainMaterialIndex('current'), null);
    this.meshPreview.setMaterialTextures(terrainMaterialIndex('current'), null);
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
    this.resizeObserver.disconnect();
    for (const trigger of this.touchRadialTriggers) trigger.dispose();
    this.touchRadialTriggers.length = 0;
    this.presetTextures.clear();
    this.radial.dispose();
    this.meshPreview.dispose();
  }

  private bindControls(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-setting]')) {
      input.addEventListener('input', () => {
        const setting = input.dataset.setting ?? '';
        const output = this.root.querySelector<HTMLOutputElement>(`[data-output="${setting}"]`);
        if (setting === 'materialScale') {
          const meters = clampMetersPerTile(Math.pow(2, Number.parseFloat(input.value)));
          this.settings.materialRepeat = repeatForMeters(meters);
          if (output !== null) output.value = scaleReadout(meters);
          this.syncMaterialScaleControls();
          this.syncMaterialInfo();
          this.scheduleRender();
          this.refreshSurface();
          return;
        }
        if (output !== null) output.value = input.value;
        if (setting === 'propDensity') {
          this.meshPreview.setGamePropDensity(Number.parseFloat(input.value));
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
    required<HTMLButtonElement>(this.root, '[data-role="terrain-inspect"]').addEventListener('click', () => {
      this.inspectSurface();
    });
    this.bindLighting();
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
    for (const material of BASE_MATERIAL_IDS) {
      const link = required<HTMLInputElement>(this.root, `[data-material-scale-linked="${material}"]`);
      const slider = required<HTMLInputElement>(this.root, `[data-material-scale="${material}"]`);
      link.addEventListener('change', () => {
        const overrides = this.settings.materialScales ??= {};
        if (link.checked) delete overrides[material];
        else overrides[material] = this.globalMetersPerTile();
        this.syncMaterialScaleControls();
        this.syncMaterialInfo();
        this.scheduleRender();
        this.refreshSurface();
      });
      slider.addEventListener('input', () => {
        if (link.checked) return;
        const meters = clampMetersPerTile(Math.pow(2, Number.parseFloat(slider.value)));
        const overrides = this.settings.materialScales ??= {};
        overrides[material] = meters;
        this.syncMaterialScaleControl(material);
        this.syncMaterialInfo();
        this.scheduleRender();
        this.refreshSurface();
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
    required<HTMLInputElement>(this.root, '[data-role="terrain-props"]').addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      this.meshPreview.setGamePropsVisible(input.checked);
    });
    required<HTMLInputElement>(this.root, '[data-role="terrain-scale-ref"]').addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      this.meshPreview.setScaleReferenceVisible(input.checked);
      if (input.checked) {
        this.setStatus('Scale reference on · double-click the terrain to pivot, then zoom in.');
      }
    });
    required<HTMLButtonElement>(this.root, '[data-role="terrain-export-height"]').addEventListener('click', () => { void this.exportHeight(); });
    required<HTMLButtonElement>(this.root, '[data-role="terrain-export-recipe"]').addEventListener('click', () => this.exportRecipe());
  }

  /**
   * A material reads completely differently at noon and at dusk, so the preset list is the
   * A/B judgement tool and the slider is for chasing a specific look. `input` fires while
   * dragging and `change` on release, which is exactly the cheap/expensive split the sky
   * bake wants.
   */
  private bindLighting(): void {
    const select = required<HTMLSelectElement>(this.root, '[data-role="terrain-lighting"]');
    const sun = required<HTMLInputElement>(this.root, '[data-role="terrain-sun"]');
    const output = required<HTMLOutputElement>(this.root, '[data-output="terrain-sun"]');
    const showSun = (degrees: number): void => {
      sun.value = String(Math.round(degrees));
      output.value = `${Math.round(degrees)}°`;
    };
    select.addEventListener('change', () => {
      if (!isTerrainLightingPresetId(select.value)) return;
      this.meshPreview.setLightingPreset(select.value);
      showSun(this.meshPreview.sunElevationDegrees);
      const label = TERRAIN_LIGHTING_PRESETS.find((preset) => preset.id === select.value)?.label;
      this.setStatus(`Lighting: ${label ?? select.value}. Sun, sky and shadows moved together.`);
    });
    sun.addEventListener('input', () => {
      const degrees = Number.parseFloat(sun.value);
      if (!Number.isFinite(degrees)) return;
      output.value = `${Math.round(degrees)}°`;
      this.meshPreview.setSunElevation(degrees, 'drag');
    });
    sun.addEventListener('change', () => {
      const degrees = Number.parseFloat(sun.value);
      if (Number.isFinite(degrees)) this.meshPreview.setSunElevation(degrees, 'final');
    });
  }

  /**
   * Opens the picker from the material card, and from a right-click on either canvas so the
   * surface itself is the control. The 2D map already uses right-drag to erase paint, so the
   * same press-distance guard the main viewport uses distinguishes the two: a right-drag
   * still erases, a right-click opens the picker.
   */
  private bindRadial(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-material-radial]')) {
      button.addEventListener('click', (event) => {
        const id = button.dataset.materialRadial ?? '';
        if (isBaseMaterialId(id)) this.openRadial(id, event.clientX, event.clientY);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-material-compare]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.materialCompare ?? '';
        if (!isBaseMaterialId(id)) return;
        this.meshPreview.toggleMaterialCompare(terrainMaterialIndex(id));
        this.setStatus(`Flipped ${id} between the current and previous preset.`);
      });
    }

    for (const canvas of [this.mapCanvas, this.meshCanvas]) {
      let rightPress: { pointerId: number; startX: number; startY: number } | null = null;
      canvas.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button === 2) {
          rightPress = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
        }
      });
      canvas.addEventListener('pointermove', (event) => {
        if (rightPress === null || event.pointerId !== rightPress.pointerId) return;
        const moved = Math.hypot(event.clientX - rightPress.startX, event.clientY - rightPress.startY);
        if (moved > UI_CONFIG.radialClickMoveTolerancePx) rightPress = null;
      });
      canvas.addEventListener('pointerup', (event) => {
        if (rightPress !== null && event.pointerId === rightPress.pointerId && event.button === 2) {
          this.openRadialAt(canvas, event.clientX, event.clientY);
        }
        rightPress = null;
      });
      canvas.addEventListener('pointercancel', () => { rightPress = null; });
      canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    }
  }

  /** Long-press is the touch equivalent of the surface/card context picker. */
  private bindTouchRadial(): void {
    for (const canvas of [this.mapCanvas, this.meshCanvas]) {
      this.touchRadialTriggers.push(new TouchRadialTrigger(canvas, {
        onTrigger: ({ clientX, clientY }) => this.openRadialAt(canvas, clientX, clientY)
      }));
    }
    const materialList = required<HTMLElement>(this.root, '.terrain-material-list');
    this.touchRadialTriggers.push(new TouchRadialTrigger(materialList, {
      onTrigger: ({ clientX, clientY, target }) => {
        const element = target instanceof Element ? target : null;
        const id = element?.closest<HTMLElement>('[data-material-radial]')?.dataset.materialRadial
          ?? element?.closest<HTMLElement>('[data-material-slot]')?.dataset.materialSlot
          ?? '';
        if (isBaseMaterialId(id)) this.openRadial(id, clientX, clientY);
      }
    }));
  }

  /** Resolves the material under the cursor, then opens the picker already aimed at it. */
  private openRadialAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
    const fields = this.fields;
    if (fields === null) return;
    const size = TerrainMeshPreview.worldSizeUnits;
    let world: { x: number; z: number } | null = null;
    if (canvas === this.meshCanvas) {
      world = this.meshPreview.pickTerrain(clientX, clientY);
    } else {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      world = {
        x: ((clientX - bounds.left) / bounds.width - 0.5) * size,
        z: ((clientY - bounds.top) / bounds.height - 0.5) * size
      };
    }
    if (world === null) return;
    const hit = sampleTerrainMaterialAt(
      fields,
      this.painter.mask,
      world.x,
      world.z,
      size,
      TerrainMeshPreview.worldHeightUnits
    );
    // `current` and `custom` hold no assignable preset, so fall back to the classification
    // underneath and say so, rather than opening a picker that cannot apply.
    if (hit.material === 'current' || hit.material === 'custom') {
      this.setStatus(`Painted ${hit.material} override here · editing ${hit.base} beneath.`);
    }
    this.openRadial(hit.base, clientX, clientY);
  }

  private openRadial(material: TerrainBaseMaterialId, anchorX: number, anchorY: number): void {
    this.cancelRadialPreview();
    this.radialMaterial = material;
    this.selectMaterial(material);
    this.radial.open({
      material,
      label: TERRAIN_MATERIALS.find((entry) => entry.id === material)?.label ?? material,
      currentPresetId: this.presetAssignments[material] ?? null,
      metersPerTile: this.materialMetersPerTile(material),
      anchorX,
      anchorY
    }, true);
  }

  /** Warms the cache, then shows the candidate on the world once it is actually resident. */
  private async previewPreset(presetId: string | null): Promise<void> {
    const sequence = ++this.radialPreviewSequence;
    const material = this.radialMaterial;
    const index = terrainMaterialIndex(material);
    if (presetId === null) {
      this.meshPreview.restoreMaterial(index);
      delete this.root.dataset.radialPreviewPreset;
      this.root.dataset.radialPreviewRestored = String(!this.meshPreview.isMaterialPreviewing(index));
      return;
    }
    const cachedTint = cachedPresetTint(presetId);
    const tint = cachedTint ?? await loadPresetTint(presetId);
    if (!this.isCurrentRadialPreview(sequence, material)) return;
    if (tint !== null) {
      this.meshPreview.previewMaterialTint(index, tint);
      this.root.dataset.radialPreviewPreset = presetId;
      delete this.root.dataset.radialPreviewRestored;
    }
    await this.presetTextures.prefetch(presetId);
    if (!this.isCurrentRadialPreview(sequence, material)) return;
    try {
      const textures = await this.presetTextures.load(presetId);
      if (!this.isCurrentRadialPreview(sequence, material)) return;
      this.meshPreview.previewMaterialTextures(index, textures);
      this.root.dataset.radialPreviewPreset = presetId;
      delete this.root.dataset.radialPreviewRestored;
    } catch {
      // The hover preview is speculative; the commit path reports failures properly.
    }
  }

  private isCurrentRadialPreview(
    sequence: number,
    material: TerrainBaseMaterialId
  ): boolean {
    return sequence === this.radialPreviewSequence &&
      this.radial.isOpen &&
      this.radialMaterial === material;
  }

  private cancelRadialPreview(): void {
    this.radialPreviewSequence += 1;
    delete this.root.dataset.radialPreviewPreset;
    this.meshPreview.restoreMaterial(terrainMaterialIndex(this.radialMaterial));
    this.root.dataset.radialPreviewRestored = String(
      !this.meshPreview.isMaterialPreviewing(terrainMaterialIndex(this.radialMaterial))
    );
  }

  /**
   * Writes through the native select and lets its change handler run, so the whole existing
   * assignment path (sequencing, progress, rollback) is reused untouched.
   */
  private commitPreset(presetId: string): void {
    const material = this.radialMaterial;
    this.cancelRadialPreview();
    const select = required<HTMLSelectElement>(this.root, `[data-material-preset="${material}"]`);
    select.value = presetId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Pushes display names and scale down so the player HUD can name what it stands on. */
  private syncMaterialInfo(): void {
    const repeats = this.materialRepeats(this.settings.materialRepeat);
    for (const material of TERRAIN_MATERIALS) {
      const presetId = isBaseMaterialId(material.id)
        ? this.presetAssignments[material.id] ?? null
        : null;
      const preset = presetId === null
        ? null
        : MATERIAL_PRESETS.find((candidate) => candidate.id === presetId) ?? null;
      this.meshPreview.setMaterialInfo(material.index, {
        presetName: preset?.name ?? null,
        metersPerTile: metersPerTile(repeats[material.index] ?? this.settings.materialRepeat)
      });
    }
  }

  private globalMetersPerTile(): number {
    return metersPerTile(this.settings.materialRepeat);
  }

  private materialMetersPerTile(material: TerrainBaseMaterialId): number {
    const override = this.settings.materialScales?.[material];
    return override === undefined ? this.globalMetersPerTile() : clampMetersPerTile(override);
  }

  private syncMaterialScaleControls(): void {
    for (const material of BASE_MATERIAL_IDS) this.syncMaterialScaleControl(material);
  }

  private syncMaterialScaleControl(material: TerrainBaseMaterialId): void {
    const linked = this.settings.materialScales?.[material] === undefined;
    const meters = this.materialMetersPerTile(material);
    const link = required<HTMLInputElement>(this.root, `[data-material-scale-linked="${material}"]`);
    const slider = required<HTMLInputElement>(this.root, `[data-material-scale="${material}"]`);
    const output = required<HTMLOutputElement>(this.root, `[data-material-scale-output="${material}"]`);
    link.checked = linked;
    slider.disabled = linked;
    slider.value = Math.log2(meters).toFixed(3);
    output.value = scaleReadout(meters);
  }

  private syncMaterialCard(material: TerrainBaseMaterialId): void {
    const presetId = this.presetAssignments[material] ?? null;
    const thumb = this.root.querySelector<HTMLElement>(`[data-material-thumb="${material}"]`);
    if (thumb !== null) {
      thumb.style.backgroundImage = presetId === null
        ? ''
        : `url(${presetThumbnailUrl(presetId)})`;
      thumb.classList.toggle('is-empty', presetId === null);
    }
    const compare = this.root.querySelector<HTMLElement>(`[data-material-compare="${material}"]`);
    if (compare !== null) {
      compare.hidden = !this.meshPreview.hasMaterialCompare(terrainMaterialIndex(material));
    }
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
      // A right click belongs to the radial picker until it becomes a drag. Touch likewise
      // waits until movement or release so a long-press can open the picker without leaving
      // a single painted texel behind.
      if (event.pointerType === 'touch' || event.button === 2) {
        this.pendingStroke = {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY
        };
      } else {
        this.pendingStroke = null;
        this.paintAt(event);
      }
    });
    this.mapCanvas.addEventListener('pointermove', (event) => {
      if (this.drawingPointer !== event.pointerId || !this.canPaint()) return;
      const pending = this.pendingStroke;
      if (pending !== null && pending.pointerId === event.pointerId) {
        pending.clientX = event.clientX;
        pending.clientY = event.clientY;
        const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (distance <= UI_CONFIG.radialClickMoveTolerancePx) return;
        this.pendingStroke = null;
        this.paintAtCoordinates(pending.startX, pending.startY);
      }
      this.paintAt(event);
    });
    const finish = (event: PointerEvent): void => {
      if (this.drawingPointer !== event.pointerId) return;
      const pending = this.pendingStroke;
      if (event.type === 'pointerup' && pending?.pointerId === event.pointerId &&
          pending.pointerType === 'touch' && this.canPaint()) {
        this.paintAtCoordinates(event.clientX, event.clientY);
      }
      this.drawingPointer = null;
      this.drawingErase = false;
      this.pendingStroke = null;
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
      this.composer.setTextures(terrainMaterialIndex(material), null);
      this.meshPreview.setMaterialTextures(terrainMaterialIndex(material), null);
      sourceLabel.textContent = 'Built-in procedural';
      this.meshPreview.clearMaterialCompare(terrainMaterialIndex(material));
      this.syncMaterialCard(material);
      this.syncMaterialInfo();
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

    // Change the world within a frame rather than leaving the old material under a spinner.
    // The real nine-channel set replaces this the moment the atlas resolves.
    let committed = false;
    const tint = cachedPresetTint(preset.id);
    if (tint !== null) {
      this.meshPreview.setMaterialTint(terrainMaterialIndex(material), tint);
    } else {
      void loadPresetTint(preset.id).then((value) => {
        if (value === null || committed) return;
        if (sequence !== this.presetLoadSequences[material]) return;
        this.meshPreview.setMaterialTint(terrainMaterialIndex(material), value);
      });
    }

    try {
      const textures = await this.presetTextures.load(preset.id, {
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
      committed = true;
      this.composer.setTextures(terrainMaterialIndex(material), textures);
      // Retaining keeps the outgoing set alive as the A/B counterpart instead of disposing
      // it, so the previous choice can be flipped back to without a reload.
      this.meshPreview.setMaterialTexturesRetaining(terrainMaterialIndex(material), textures);
      this.presetAssignments[material] = preset.id;
      sourceLabel.textContent = preset.name;
      this.syncMaterialCard(material);
      this.syncMaterialInfo();
      this.setStatus(`${materialLabel} now uses ${preset.name}.`);
      this.scheduleRender();
      this.refreshSurface();
    } catch (error) {
      if (sequence !== this.presetLoadSequences[material]) return;
      if (error instanceof TerrainPresetBakeCancelled) return;
      committed = true;
      this.meshPreview.setMaterialTint(terrainMaterialIndex(material), null);
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
    this.paintAtCoordinates(event.clientX, event.clientY);
  }

  private paintAtCoordinates(clientX: number, clientY: number): void {
    const bounds = this.mapCanvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = (clientX - bounds.left) / bounds.width;
    const y = (clientY - bounds.top) / bounds.height;
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
    this.paintRevision += 1;
    this.root.dataset.paintRevision = String(this.paintRevision);
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

  private inspectSurface(): void {
    if (this.meshPreview.playerState !== 'idle') this.meshPreview.exitPlayerMode();
    this.setPreviewMode('3d');
    const scaleReference = required<HTMLInputElement>(this.root, '[data-role="terrain-scale-ref"]');
    scaleReference.checked = true;
    this.meshPreview.setScaleReferenceVisible(true);
    requestAnimationFrame(() => {
      if (this.meshPreview.inspectSurface()) {
        this.setStatus('Inspecting at human scale · wheel to zoom, drag to orbit, double-click to repivot.');
      } else {
        this.setStatus('Could not find terrain beneath the inspection reticle.');
      }
    });
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
    this.mapCanvas.hidden = false;
    this.mapCanvas.classList.toggle('is-inset', mode === '3d');
    this.meshCanvas.hidden = mode !== '3d';
    this.viewSelect.disabled = false;
    for (const control of this.root.querySelectorAll<HTMLSelectElement | HTMLInputElement>(
      '[data-role="terrain-lighting"], [data-role="terrain-sun"]'
    )) {
      control.disabled = mode !== '3d';
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-preview]')) {
      button.classList.toggle('is-active', button.dataset.preview === mode);
    }
    this.scheduleRender();
    if (mode === '3d') this.refreshSurface();
  }

  private scheduleRender(): void {
    if (this.renderFrame !== 0) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      if (this.mapCanvas.hidden) return;
      if (this.viewMode === 'repeat') {
        this.composer.renderMaterialRepeatPreview(
          this.mapCanvas,
          terrainMaterialIndex(this.selectedMaterial)
        );
        this.drawMapMarker();
        return;
      }
      if (this.fields !== null) {
        this.composer.renderPreview(
          this.mapCanvas,
          this.fields,
          this.painter.mask,
          this.viewMode,
          Math.min(this.settings.materialRepeat, MAP_PREVIEW_MAX_REPEAT)
        );
        this.drawMapMarker();
      }
    });
  }

  private drawMapMarker(): void {
    if (this.previewMode !== '3d') {
      delete this.root.dataset.mapMarker;
      this.mapMarker.hidden = true;
      return;
    }
    const marker = this.meshPreview.getMapMarker();
    if (marker === null) {
      delete this.root.dataset.mapMarker;
      this.mapMarker.hidden = true;
      return;
    }
    const stack = this.mapCanvas.parentElement?.getBoundingClientRect();
    const bounds = this.mapCanvas.getBoundingClientRect();
    if (stack === undefined || bounds.width <= 0 || bounds.height <= 0) return;
    const markerMargin = Math.max(9, bounds.width * 0.05);
    const x = Math.max(markerMargin, Math.min(
      bounds.width - markerMargin,
      (marker.x / TerrainMeshPreview.worldSizeUnits + 0.5) * bounds.width
    ));
    const y = Math.max(markerMargin, Math.min(
      bounds.height - markerMargin,
      (marker.z / TerrainMeshPreview.worldSizeUnits + 0.5) * bounds.height
    ));
    const length = Math.hypot(marker.directionX, marker.directionZ) || 1;
    const dx = marker.directionX / length;
    const dy = marker.directionZ / length;
    this.root.dataset.mapMarker = `${x.toFixed(1)},${y.toFixed(1)}`;
    this.mapMarker.hidden = false;
    this.mapMarker.style.left = `${bounds.left - stack.left + x}px`;
    this.mapMarker.style.top = `${bounds.top - stack.top + y}px`;
    this.mapMarker.style.transform =
      `translate(-50%, -50%) rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
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
    this.meshPreview.update(
      this.fields,
      this.painter.mask,
      this.materialRepeats(this.settings.materialRepeat)
    );
  }

  /** Per-material repeat counts, falling back to the global scale where there is no override. */
  private materialRepeats(globalRepeat: number): number[] {
    const repeats = new Array<number>(TERRAIN_MATERIALS.length).fill(globalRepeat);
    const overrides = this.settings.materialScales ?? {};
    for (const material of TERRAIN_MATERIALS) {
      const meters = overrides[material.id];
      if (meters === undefined || !Number.isFinite(meters) || meters <= 0) continue;
      repeats[material.index] = repeatForMeters(meters);
    }
    return repeats;
  }

  private async importTexture(file: File): Promise<void> {
    const sequence = ++this.textureImportSequence;
    try {
      const texture = await textureFromFile(file);
      if (sequence !== this.textureImportSequence) return;
      const textures = { albedo: texture };
      this.composer.setTextures(terrainMaterialIndex('custom'), textures);
      this.meshPreview.setMaterialTextures(terrainMaterialIndex('custom'), textures);
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
