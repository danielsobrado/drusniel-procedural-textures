import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ktx2TextureResolver } from '../src/assets/Ktx2TextureResolver';

const resolverSource = readFileSync(
  new URL('../src/assets/Ktx2TextureResolver.ts', import.meta.url),
  'utf8'
);
const bakeTextureFieldsSource = readFileSync(
  new URL('../src/assets/Ktx2BakeTextureFields.ts', import.meta.url),
  'utf8'
);
const compilerSource = readFileSync(
  new URL('../src/materials/MaterialCompiler.ts', import.meta.url),
  'utf8'
);
const rendererSource = readFileSync(
  new URL('../src/engine/LabRenderer.ts', import.meta.url),
  'utf8'
);
const bakerSource = readFileSync(
  new URL('../src/export/TextureBaker.ts', import.meta.url),
  'utf8'
);
const webGpuBakerSource = readFileSync(
  new URL('../src/export/WebGpuTextureBaker.ts', import.meta.url),
  'utf8'
);
const glbExporterSource = readFileSync(
  new URL('../src/export/GlbExporter.ts', import.meta.url),
  'utf8'
);
const thumbnailSource = readFileSync(
  new URL('../src/export/PresetThumbnailRenderer.ts', import.meta.url),
  'utf8'
);
const terrainPresetSource = readFileSync(
  new URL('../src/tile/TerrainPresetTextureLibrary.ts', import.meta.url),
  'utf8'
);

describe('KTX2 renderer injection', () => {
  it('does not allocate a hidden renderer for KTX2 detection', () => {
    expect(resolverSource).not.toContain('new THREE.WebGLRenderer');
    expect(resolverSource).not.toContain('new WebGPURenderer');
    expect(resolverSource).not.toContain('forceContextLoss');
    expect(resolverSource).toContain('const renderer = await provider();');
    expect(resolverSource).toContain('loader.detectSupport(renderer);');
  });

  it('initializes the transcoder before the resolver owns a disposable loader', () => {
    expect(resolverSource).toContain('await loader.init();');
    expect(resolverSource).toContain('this.loader = loader;');
    expect(resolverSource.indexOf('await loader.init();')).toBeLessThan(
      resolverSource.indexOf('this.loader = loader;')
    );
  });

  it('caps texture-field anisotropy against the support renderer', () => {
    expect(resolverSource).toContain('anisotropyRenderer.getMaxAnisotropy?.()');
    expect(resolverSource).toContain('capabilities?.getMaxAnisotropy?.()');
    expect(resolverSource).toContain('RUNTIME_TEXTURE_FIELD_CONFIG.sampling.maxAnisotropy');
    expect(resolverSource).toContain('texture.anisotropy = this.textureAnisotropy;');
  });

  it('requires the host renderer before texture loading starts', async () => {
    const resolver = new Ktx2TextureResolver();
    try {
      await expect(resolver.resolve('perlin.01')).rejects.toThrow(/support renderer has not been configured/iu);
    } finally {
      resolver.dispose();
    }
  });

  it('can retry support initialization after a provider failure', async () => {
    const resolver = new Ktx2TextureResolver();
    let attempts = 0;
    resolver.setSupportRendererProvider(async () => {
      attempts += 1;
      throw new Error('Renderer is not ready.');
    });

    try {
      await expect(resolver.resolve('perlin.01')).rejects.toThrow(/not ready/iu);
      await expect(resolver.resolve('perlin.01')).rejects.toThrow(/not ready/iu);
      expect(attempts).toBe(2);
    } finally {
      resolver.dispose();
    }
  });

  it('routes the initialized WebGPU renderer through the compiler without transferring ownership', () => {
    expect(compilerSource).toContain('setTextureSupportRendererProvider(provider: Ktx2SupportRendererProvider)');
    expect(compilerSource).toContain('this.textureResolver.setSupportRendererProvider(provider);');
    expect(rendererSource).toContain('this.rendererReady = this.initializeRenderer();');
    expect(rendererSource).toContain(
      'this.compiler.setTextureSupportRendererProvider(() => this.requireTextureSupportRenderer());'
    );
    expect(rendererSource).toContain('await this.rendererReady;');
    expect(rendererSource).toContain("throw new Error('WebGPU renderer is unavailable for KTX2 texture fields.'");
    expect(resolverSource).not.toContain('renderer.dispose()');
  });

  it('transcodes bake fields against the WebGL renderer that samples them', () => {
    expect(compilerSource).toContain('private readonly bakeTextureFields = new Ktx2BakeTextureFields();');
    expect(compilerSource).toContain('public async ensureBakeReady(renderer: THREE.WebGLRenderer)');
    expect(compilerSource).toContain('await this.bakeTextureFields.prepare(renderer);');
    expect(bakerSource).toContain('await this.compiler.ensureBakeReady(this.renderer);');
    expect(bakerSource).toContain('this.compiler.applyBakeTextureFields(material);');
    expect(bakerSource).toContain('this.compiler.applyBakeTextureFields(displacementMaterial);');
    expect(bakeTextureFieldsSource).toContain('private resolver = this.createResolver();');
    expect(bakeTextureFieldsSource).toContain('if (this.renderer !== renderer) this.setRenderer(renderer);');
    expect(compilerSource).toContain('this.textureResolver.releaseTranscoderWhenIdle();');
    expect(bakeTextureFieldsSource).toContain('this.resolver.releaseTranscoderWhenIdle();');
  });

  it('keeps WebGL baking independent from preview texture readiness', () => {
    const bakeReadyStart = compilerSource.indexOf('public async ensureBakeReady');
    const bakeReadyEnd = compilerSource.indexOf('public applyBakeTextureFields', bakeReadyStart);
    const bakeReadySource = compilerSource.slice(bakeReadyStart, bakeReadyEnd);

    expect(bakeReadySource).toContain('await this.simulationPromise;');
    expect(bakeReadySource).not.toContain('ensureSimulationReady');
    expect(bakerSource).toContain('public async prepare(): Promise<void>');
    expect(glbExporterSource).toContain('await this.baker.prepare();');
    expect(glbExporterSource).not.toContain('await this.compiler.ensureSimulationReady();');
  });

  it('reuses the thumbnail generator WebGL renderer instead of creating another context', () => {
    expect(thumbnailSource).toContain(
      'this.compiler.setTextureSupportRendererProvider(async () => this.renderer);'
    );
  });

  it('keeps cached terrain preset previews out of the KTX2 renderer path', () => {
    expect(terrainPresetSource).toContain('loadPresetTerrainTexture(preset.id, resolution)');
    expect(terrainPresetSource).not.toContain('setTextureSupportRendererProvider');
    expect(terrainPresetSource).not.toContain('TileMaterialBaker');
  });

  it('binds a valid fallback for the simulation sampler in portable bake materials', () => {
    expect(compilerSource).toContain('bakeUniforms.uLabSimulationAtlas.value = this.textureFallback;');
  });

  it('caps WebGPU attachment batches against the device byte limit', () => {
    expect(webGpuBakerSource).toContain('maxColorAttachmentBytesPerSample');
    expect(webGpuBakerSource).toContain('Math.floor(maxBytes / 8)');
  });

  it('parks a failed texture-field preparation under a fingerprint no layer set can produce', () => {
    // '' is the fingerprint of a layer set that needs no texture fields, so reusing it
    // for the failure state leaks a stale textureError into the next sync.
    expect(compilerSource).toContain('this.textureFingerprint = FAILED_TEXTURE_FINGERPRINT;');
    expect(compilerSource).not.toContain("this.textureFingerprint = '';");
    const sentinel = /const FAILED_TEXTURE_FINGERPRINT = '(.*)';/u.exec(compilerSource)?.[1];
    expect(sentinel).toBeTruthy();
    expect(sentinel).not.toMatch(/^[\w.|-]*$/u);
  });
});
