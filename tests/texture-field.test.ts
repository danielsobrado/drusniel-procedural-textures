import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AppState, createDefaultProject } from '../src/app/AppState';
import {
  TEXTURE_LIBRARY_ASSETS,
  TEXTURE_LIBRARY_CONFIG
} from '../src/config/textureLibraryConfig';
import type { SurfaceGraphDefinition } from '../src/core/graph/SurfaceGraph';
import {
  setSurfaceGraphExposedValue,
  surfaceGraphExposedValue
} from '../src/core/graph/SurfaceGraphParameters';
import { normalizeSurfaceGraph } from '../src/core/graph/SurfaceGraphValidation';
import {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  normalizeTextureFieldSettings
} from '../src/core/texture/TextureFieldSettings';
import { HYBRID_TARGET_PRESET_IDS } from '../src/materials/hybridPresetEnhancements';
import { MATERIAL_PRESETS } from '../src/materials/presets';
import { SurfaceMaterialCompiler } from '../src/materials/SurfaceMaterialCompiler';
import { TEXTURE_FIELD_PRESETS } from '../src/materials/textureFieldPresets';
import { createMaterialRecipe, parseMaterialRecipe } from '../src/runtime/MaterialRecipe';
import { ProceduralMaterial } from '../src/runtime/ProceduralMaterial';

function texturePreset(family: string) {
  const preset = TEXTURE_FIELD_PRESETS.find((item) => item.id === `texture-field-${family}`);
  if (preset === undefined || preset.graph === undefined) {
    throw new Error(`Texture-field preset ${family} is missing.`);
  }
  return preset;
}

function explicitTextureGraph(): SurfaceGraphDefinition {
  return {
    version: 1,
    id: 'texture-runtime-graph',
    name: 'Texture runtime graph',
    nodes: [{
      id: 'field',
      kind: 'texture-field',
      label: 'Texture field',
      position: { x: 0, y: 0 },
      params: {
        textureId: 'perlin.01',
        scaleX: 1,
        sampleChannel: 'r',
        invert: false,
        mode: 'replace',
        modeAmount: 1
      },
      runtime: {
        kind: 'base',
        channel: 'height',
        texture: { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.01' }
      }
    }],
    edges: [],
    outputs: [{ channel: 'height', source: { nodeId: 'field', port: 'height' } }],
    exposed: [
      {
        id: 'texture',
        label: 'Texture',
        nodeId: 'field',
        parameter: 'textureId',
        type: 'enum',
        defaultValue: 'perlin.01',
        options: ['perlin.01', 'perlin.02']
      },
      {
        id: 'scale-x',
        label: 'Scale X',
        nodeId: 'field',
        parameter: 'scaleX',
        type: 'float',
        defaultValue: 1,
        min: 0.1,
        max: 8,
        step: 0.1
      },
      {
        id: 'channel',
        label: 'Channel',
        nodeId: 'field',
        parameter: 'sampleChannel',
        type: 'enum',
        defaultValue: 'r',
        options: ['r', 'g', 'luminance']
      },
      {
        id: 'invert',
        label: 'Invert',
        nodeId: 'field',
        parameter: 'invert',
        type: 'boolean',
        defaultValue: false
      },
      {
        id: 'mode',
        label: 'Mode',
        nodeId: 'field',
        parameter: 'mode',
        type: 'enum',
        defaultValue: 'replace',
        options: ['replace', 'modulate', 'warp', 'detail']
      },
      {
        id: 'mode-amount',
        label: 'Mode amount',
        nodeId: 'field',
        parameter: 'modeAmount',
        type: 'float',
        defaultValue: 1,
        min: 0,
        max: 4,
        step: 0.01
      }
    ],
    groups: [],
    subgraphs: []
  };
}

describe('texture fields', () => {
  it('normalizes explicit field roles while keeping legacy recipes in replace mode', () => {
    expect(normalizeTextureFieldSettings({ id: 'perlin.01' })).toEqual(expect.objectContaining({
      mode: 'replace',
      modeAmount: 1
    }));
    expect(normalizeTextureFieldSettings({
      id: 'perlin.01',
      mode: 'detail',
      modeAmount: 0.35
    })).toEqual(expect.objectContaining({ mode: 'detail', modeAmount: 0.35 }));
    expect(() => normalizeTextureFieldSettings({ id: 'perlin.01', mode: 'unknown' })).toThrow(
      /texture field mode/iu
    );
    expect(() => normalizeTextureFieldSettings({ id: 'perlin.01', modeAmount: 4.1 })).toThrow(
      /mode amount/iu
    );
  });

  it('round-trips field roles through material recipes', () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = {
      ...DEFAULT_TEXTURE_FIELD_SETTINGS,
      id: 'grainy.04',
      mode: 'detail',
      modeAmount: 0.42
    };
    const parsed = parseMaterialRecipe(JSON.parse(JSON.stringify(createMaterialRecipe(project))) as unknown);
    expect(parsed.layers[0]?.texture).toEqual(expect.objectContaining({
      id: 'grainy.04',
      mode: 'detail',
      modeAmount: 0.42
    }));
  });

  it('keeps standalone fields replacing and re-authors hybrid fields as combinations', () => {
    expect(texturePreset('cracks').layers[0]?.texture?.mode).toBe('replace');

    const hybridIds = new Set([
      ...HYBRID_TARGET_PRESET_IDS,
      'adipose-v8',
      'cut-cobble-stone',
      'weathered-flagstone'
    ]);
    const hybridFields = MATERIAL_PRESETS
      .filter((preset) => hybridIds.has(preset.id))
      .flatMap((preset) => preset.layers)
      .flatMap((layer) => layer.texture === null || layer.texture === undefined ? [] : [layer.texture]);
    expect(hybridFields.length).toBeGreaterThan(50);
    expect(hybridFields.every((field) => field.mode === 'modulate' || field.mode === 'detail')).toBe(true);

    const detailFields = hybridFields.filter((field) => field.mode === 'detail');
    expect(detailFields).toHaveLength(4);
    expect(detailFields.every((field) => field.modeAmount === 0.35)).toBe(true);
  });

  it('registers the complete packed KTX2 catalog without changing stable ids', () => {
    expect(TEXTURE_LIBRARY_ASSETS).toHaveLength(117);
    expect(new Set(TEXTURE_LIBRARY_ASSETS.map((asset) => asset.id)).size).toBe(117);
    expect(TEXTURE_LIBRARY_CONFIG.version).toBe(2);
    expect(new Set(TEXTURE_LIBRARY_ASSETS.map((asset) => asset.file)).size).toBe(41);
    expect(new Set(TEXTURE_LIBRARY_ASSETS.map((asset) => `${asset.file}#${asset.channel}`)).size).toBe(117);
    expect(TEXTURE_LIBRARY_ASSETS).toContainEqual(expect.objectContaining({
      id: 'cracks.01',
      path: 'textures/cracks-pack-01.ktx2',
      channel: 'r'
    }));
    expect(TEXTURE_LIBRARY_ASSETS).toContainEqual(expect.objectContaining({
      id: 'cracks.02',
      path: 'textures/cracks-pack-01.ktx2',
      channel: 'g'
    }));
    expect(TEXTURE_LIBRARY_ASSETS.every((asset) => asset.tileable && asset.colorSpace === 'linear')).toBe(true);
    expect(TEXTURE_LIBRARY_ASSETS.every((asset) => (
      asset.license === 'Apache-2.0' &&
      asset.provenance === 'deterministic-project-generator-v1' &&
      asset.source === 'scripts/generate-texture-library.mjs'
    ))).toBe(true);
    expect(TEXTURE_LIBRARY_CONFIG.generation).toEqual(expect.objectContaining({
      format: 'UASTC',
      supercompression: 'Zstandard',
      referencedResolution: 1024,
      longTailResolution: 512,
      encodedByteBudget: 50_331_648
    }));
  });

  it('lets a packed resolver channel override the logical recipe channel', () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = {
      ...DEFAULT_TEXTURE_FIELD_SETTINGS,
      id: 'cracks.03',
      channel: 'r'
    };
    const compiler = new SurfaceMaterialCompiler();
    const texture = new THREE.Texture();
    const channelUniform = (compiler as unknown as {
      uniforms: { uLabTextureChannel: { value: number[] } };
    }).uniforms.uLabTextureChannel.value;

    try {
      compiler.sync(project.layers, project.groups, false, project.synthesis, project.coordinateSpace);
      expect(channelUniform[0]).toBe(0);
      compiler.setTextureFields(new Map([['cracks.03', { texture, channel: 'b' }]]));
      expect(channelUniform[0]).toBe(2);
      compiler.setTextureFields(new Map());
      expect(channelUniform[0]).toBe(0);
    } finally {
      compiler.dispose();
      texture.dispose();
    }
  });

  it('keeps texture metadata when a graph-backed layer is detached for direct editing', () => {
    const state = new AppState();
    state.applyPreset(texturePreset('cracks'));
    const layerId = state.snapshot.layers[0]?.id;
    if (layerId === undefined) throw new Error('Texture-field layer is missing.');

    state.setSurfaceGraphParameter('texture', 'cracks.03');
    expect(state.snapshot.layers[0]?.texture?.id).toBe('cracks.03');

    state.updateLayer(layerId, { opacity: 0.63 });
    expect(state.snapshot.surfaceGraph).toBeNull();
    expect(state.snapshot.layers[0]?.texture?.id).toBe('cracks.03');
  });

  it('normalizes and updates explicit texture runtime bindings', () => {
    const normalized = normalizeSurfaceGraph(explicitTextureGraph());
    expect(normalized.nodes[0]?.runtime?.texture?.id).toBe('perlin.01');

    const withTexture = setSurfaceGraphExposedValue(normalized, 'texture', 'perlin.02');
    const withScale = setSurfaceGraphExposedValue(withTexture, 'scale-x', 2.5);
    const withChannel = setSurfaceGraphExposedValue(withScale, 'channel', 'luminance');
    const inverted = setSurfaceGraphExposedValue(withChannel, 'invert', true);
    const modulated = setSurfaceGraphExposedValue(inverted, 'mode', 'modulate');
    const withModeAmount = setSurfaceGraphExposedValue(modulated, 'mode-amount', 0.65);

    expect(surfaceGraphExposedValue(withModeAmount, 'texture')).toBe('perlin.02');
    expect(withModeAmount.nodes[0]?.runtime?.texture).toEqual(expect.objectContaining({
      id: 'perlin.02',
      scaleX: 2.5,
      channel: 'luminance',
      invert: true,
      mode: 'modulate',
      modeAmount: 0.65
    }));
  });

  it('exposes constrained field-role controls on standalone texture graphs', () => {
    const graph = texturePreset('perlin').graph!;
    expect(graph.nodes[0]?.params).toEqual(expect.objectContaining({ mode: 'replace', modeAmount: 1 }));
    expect(graph.exposed).toContainEqual(expect.objectContaining({
      id: 'mode',
      type: 'enum',
      options: ['replace', 'modulate', 'warp', 'detail']
    }));
    expect(graph.exposed).toContainEqual(expect.objectContaining({ id: 'mode-amount', type: 'float' }));
  });

  it('declares texture dependencies in versioned material recipes', () => {
    const state = new AppState();
    state.applyPreset(texturePreset('perlin'));
    state.setSurfaceGraphParameter('texture', 'perlin.03');

    const recipe = createMaterialRecipe(state.snapshot, 91, 'object');
    expect(recipe.dependencies?.textures).toEqual([{ id: 'perlin.03', version: 1 }]);

    const parsed = parseMaterialRecipe(JSON.parse(JSON.stringify(recipe)) as unknown);
    expect(parsed.dependencies?.textures).toEqual([{ id: 'perlin.03', version: 1 }]);
    expect(parsed.layers[0]?.texture?.id).toBe('perlin.03');
    expect(() => parseMaterialRecipe({ ...recipe, version: 2 })).toThrow(/texture-field.*version/iu);
  });

  it('resolves portable texture dependencies through the consumer-owned resolver', async () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.01' };
    const texture = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat);
    let resolveCount = 0;
    let releaseCount = 0;
    const runtime = new ProceduralMaterial(createMaterialRecipe(project), {
      textureResolver: {
        resolve: async (id) => {
          expect(id).toBe('perlin.01');
          resolveCount += 1;
          return texture;
        },
        release: (id, released) => {
          expect(id).toBe('perlin.01');
          expect(released).toBe(texture);
          releaseCount += 1;
        }
      }
    });

    try {
      expect(runtime.textureFieldSource).toBe('external');
      await runtime.prepare();
      runtime.setSeed(17);
      await runtime.prepare();
      expect(resolveCount).toBe(1);
    } finally {
      runtime.dispose();
      texture.dispose();
    }
    expect(releaseCount).toBe(1);
  });

  it('prepares texture-bearing recipes with the self-contained generated source by default', async () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.01' };
    const runtime = new ProceduralMaterial(createMaterialRecipe(project), {
      generatedTextureFields: { resolution: 32 }
    });
    let generatedTextureDisposals = 0;
    try {
      expect(runtime.textureFieldSource).toBe('generated');
      await expect(runtime.prepare()).resolves.toBeUndefined();
      const generated = (runtime as unknown as {
        resolvedTextures: Map<string, { texture: THREE.Texture }>;
      }).resolvedTextures.get('perlin.01');
      if (generated === undefined) throw new Error('Generated texture field was not prepared.');
      generated.texture.addEventListener('dispose', () => { generatedTextureDisposals += 1; });
    } finally {
      runtime.dispose();
    }
    expect(generatedTextureDisposals).toBe(1);
  });

  it('keeps a strict external-only deployment option', async () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'perlin.01' };
    const runtime = new ProceduralMaterial(createMaterialRecipe(project), {
      textureFieldSource: 'external'
    });
    try {
      await expect(runtime.prepare()).rejects.toThrow(/texture fields.*textureResolver/isu);
    } finally {
      runtime.dispose();
    }
  });

  it('does not silently synthesize host-specific texture families', async () => {
    const project = createDefaultProject();
    project.layers[0]!.texture = {
      ...DEFAULT_TEXTURE_FIELD_SETTINGS,
      id: 'custom-image.01'
    };
    const runtime = new ProceduralMaterial(createMaterialRecipe(project), {
      generatedTextureFields: { resolution: 32 }
    });
    try {
      await expect(runtime.prepare()).rejects.toThrow(/not built in/iu);
    } finally {
      runtime.dispose();
    }
  });
});
