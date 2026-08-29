import * as THREE from 'three';
import { Ktx2BakeTextureFields } from '../assets/Ktx2BakeTextureFields';
import {
  Ktx2TextureResolver,
  type Ktx2SupportRendererProvider
} from '../assets/Ktx2TextureResolver';
import {
  DEFAULT_MATERIAL_ALGORITHMS,
  type MaterialAlgorithmSettings
} from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { requiredTextureFieldIds } from '../core/material/MaterialFieldDependencies';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import type { TextureFieldResource } from '../core/texture/ResolvedTextureField';
import { MaterialComputeEngine, type ComputeStatus } from '../engine/MaterialComputeEngine';
import {
  buildMaterialSimulationAtlas,
  materialRequiresSimulation,
  materialSimulationFingerprint
} from '../engine/SimulationAtlas';
import {
  BAKE_VERTEX_GLSL,
  createBakeFragmentGlsl,
  type BakeShaderPass,
  type BakeShaderProfile
} from '../export/TextureBakeShader';
import { applyPhysicalSettings } from './PhysicalMaterial';
import type {
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from './types';
import { SurfaceMaterialCompiler } from './SurfaceMaterialCompiler';
import { WebGpuMaterialCompiler } from './WebGpuMaterialCompiler';

const COMPACT_BAKE_KINDS = new Set<MaterialLayer['kind']>([
  'base',
  'fbm',
  'cellular',
  'ridges',
  'spots',
  'veins',
  'gradient',
  'vessels',
  'wet-film',
  'sss'
]);

function bakeShaderProfileFor(
  layers: readonly MaterialLayer[],
  synthesis?: Readonly<SynthesisSettings>
): BakeShaderProfile {
  if ((synthesis?.stochasticTiling ?? 0) > 0) return 'portable';
  if (layers.some((layer) => layer.texture !== null && layer.texture !== undefined)) return 'portable';
  return layers.some((layer) => !COMPACT_BAKE_KINDS.has(layer.kind)) ? 'portable' : 'compact';
}

function trimBakeLayerUniforms(uniforms: readonly THREE.IUniform[], layerCount: number): void {
  for (const uniform of uniforms) {
    if (Array.isArray(uniform.value) && uniform.value.length === PTL_MAX_LAYERS) {
      uniform.value = uniform.value.slice(0, layerCount);
    }
  }
}

// Fingerprints are `ids.join('|')`, so a layer set that needs no texture fields
// fingerprints as ''. Parking a failed preparation under '' would collide with that
// and make the stale textureError survive into the next sync, so failures use a
// sentinel that no real id list can produce.
const FAILED_TEXTURE_FINGERPRINT = '\u0000texture-field-failure';

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback, { cause: error });
}

export class MaterialCompiler extends SurfaceMaterialCompiler {
  private readonly compute = new MaterialComputeEngine();
  private readonly webGpu = new WebGpuMaterialCompiler();
  private readonly textureResolver = new Ktx2TextureResolver();
  private readonly bakeTextureFields = new Ktx2BakeTextureFields();
  private algorithmSettings: MaterialAlgorithmSettings = structuredClone(DEFAULT_MATERIAL_ALGORITHMS);
  private simulationFingerprint = '';
  private simulationSequence = 0;
  private simulationPromise: Promise<void> | null = null;
  private textureFingerprint = '';
  private textureSequence = 0;
  private texturePromise: Promise<void> | null = null;
  private textureError: Error | null = null;
  private bakeShaderProfile: BakeShaderProfile = 'compact';
  private bakeLayerCount = 1;

  public get renderMaterial(): THREE.Material {
    return this.webGpu.material;
  }

  public get computeStatus(): Readonly<ComputeStatus> {
    return this.compute.status;
  }

  /**
   * Forwarded from the WebGPU compiler so a texture bake can evaluate the very node graph the
   * viewport renders, against its own UV-space sample position. See WebGpuTextureBaker.
   */
  public buildSurfaceNodes(
    position: Parameters<WebGpuMaterialCompiler['buildSurfaceNodes']>[0],
    triplanarNormal: Parameters<WebGpuMaterialCompiler['buildSurfaceNodes']>[1]
  ): ReturnType<WebGpuMaterialCompiler['buildSurfaceNodes']> {
    return this.webGpu.buildSurfaceNodes(position, triplanarNormal);
  }

  public get physicalUniforms(): WebGpuMaterialCompiler['physicalUniforms'] {
    return this.webGpu.physicalUniforms;
  }

  public get sampleCoordinateSpace(): MaterialCoordinateSpace {
    return this.webGpu.sampleCoordinateSpace;
  }

  public initializeCompute(): Promise<Readonly<ComputeStatus>> {
    return this.compute.initialize();
  }

  public setTextureSupportRendererProvider(provider: Ktx2SupportRendererProvider): void {
    this.textureResolver.setSupportRendererProvider(provider);
  }

  public isProceduralMaterial(material: THREE.Material | readonly THREE.Material[]): boolean {
    return Array.isArray(material)
      ? material.some((item) => item === this.material || item === this.webGpu.material)
      : material === this.material || material === this.webGpu.material;
  }

  public override sync(
    layers: readonly MaterialLayer[],
    groups: readonly MaterialGroup[],
    wireframe: boolean,
    synthesis?: Readonly<SynthesisSettings>,
    coordinateSpace: MaterialCoordinateSpace = 'world'
  ): void {
    super.sync(layers, groups, wireframe, synthesis, coordinateSpace);
    this.webGpu.sync(layers, groups, wireframe, synthesis, coordinateSpace);
    this.bakeShaderProfile = bakeShaderProfileFor(layers, synthesis);
    this.bakeLayerCount = Math.max(1, this.uniforms.uLabCount.value);
    this.bakeTextureFields.setDependencies(
      layers.slice(0, PTL_MAX_LAYERS).map((layer) => layer.texture?.id ?? null),
      requiredTextureFieldIds(layers)
    );
    this.scheduleSimulation(layers);
    this.scheduleTextureFields(layers);
  }

  public applyPhysical(settings: Readonly<PhysicalSettings>): void {
    applyPhysicalSettings(this.material, settings);
    this.webGpu.setPhysical(settings);
  }

  public override setAlgorithmSettings(settings: Readonly<MaterialAlgorithmSettings>): void {
    this.algorithmSettings = structuredClone(settings);
    super.setAlgorithmSettings(settings);
    this.webGpu.setAlgorithmSettings(settings);
  }

  public override setTextureFields(textures: ReadonlyMap<string, TextureFieldResource>): void {
    super.setTextureFields(textures);
    this.webGpu.setTextureFields(textures);
  }

  public override setSimulationAtlas(
    texture: THREE.Texture | null,
    readyLayers: readonly boolean[] = [],
    cellSize = 1
  ): void {
    this.webGpu.setSimulationAtlas(texture, readyLayers, cellSize);
    super.setSimulationAtlas(texture, readyLayers, cellSize);
  }

  public async ensureSimulationReady(): Promise<void> {
    await this.simulationPromise;
    await this.texturePromise;
    if (this.textureError !== null) {
      throw new Error('Texture-field preparation failed.', { cause: this.textureError });
    }
  }

  public async ensureBakeReady(renderer: THREE.WebGLRenderer): Promise<void> {
    await this.simulationPromise;
    this.textureResolver.releaseTranscoderWhenIdle();
    await this.bakeTextureFields.prepare(renderer);
  }

  public applyBakeTextureFields(material: THREE.ShaderMaterial): void {
    const textureUniform = material.uniforms.uLabTextureFields;
    if (textureUniform !== undefined) {
      textureUniform.value = this.bakeTextureFields.apply(
        this.uniforms.uLabTextureFields.value.slice(0, this.bakeLayerCount)
      );
    }
    const channelUniform = material.uniforms.uLabTextureChannel;
    if (channelUniform !== undefined) {
      channelUniform.value = this.bakeTextureFields.applyChannels(
        this.uniforms.uLabTextureChannel.value.slice(0, this.bakeLayerCount)
      );
    }
  }

  public createBakeMaterial(
    settings: Readonly<PhysicalSettings>,
    pass: BakeShaderPass = 'surface'
  ): THREE.ShaderMaterial {
    const bakeUniforms = THREE.UniformsUtils.clone(this.uniforms);
    trimBakeLayerUniforms(Object.values(bakeUniforms), this.bakeLayerCount);
    const bakeTextureFields = bakeUniforms.uLabTextureFields;
    if (bakeTextureFields !== undefined) {
      bakeTextureFields.value = this.bakeTextureFields.apply(
        this.uniforms.uLabTextureFields.value.slice(0, this.bakeLayerCount)
      );
    }
    const bakeTextureChannels = bakeUniforms.uLabTextureChannel;
    if (bakeTextureChannels !== undefined) {
      bakeTextureChannels.value = this.bakeTextureFields.applyChannels(
        this.uniforms.uLabTextureChannel.value.slice(0, this.bakeLayerCount)
      );
    }
    const bakeSimulationAtlas = bakeUniforms.uLabSimulationAtlas?.value;
    if (
      bakeUniforms.uLabSimulationAtlas !== undefined &&
      (bakeUniforms.uLabSimulationAtlas.value === null || bakeUniforms.uLabSimulationAtlas.value === undefined)
    ) {
      bakeUniforms.uLabSimulationAtlas.value = this.textureFallback;
    }
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...bakeUniforms,
        uBakeMode: { value: 0 },
        uBakeBaseRoughness: { value: settings.roughness },
        uBakeBaseMetalness: { value: settings.metalness },
        uBakeBaseClearcoat: { value: settings.clearcoat },
        uBakeBaseClearcoatRoughness: { value: settings.clearcoatRoughness },
        uBakeHeightExtent: { value: Math.max(this.displacementExtent, 0.000001) }
      },
      vertexShader: BAKE_VERTEX_GLSL,
      fragmentShader: createBakeFragmentGlsl(this.bakeShaderProfile, this.bakeLayerCount, pass),
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false
    });
    material.name = pass === 'surface'
      ? 'Procedural Texture Lab Bake'
      : 'Procedural Texture Lab Bake Displacement';

    if (bakeSimulationAtlas instanceof THREE.Texture) {
      const disposeSimulationAtlas = (): void => {
        material.removeEventListener('dispose', disposeSimulationAtlas);
        bakeSimulationAtlas.dispose();
      };
      material.addEventListener('dispose', disposeSimulationAtlas);
    }

    return material;
  }

  public override dispose(): void {
    this.simulationSequence += 1;
    this.simulationPromise = null;
    this.textureSequence += 1;
    this.texturePromise = null;
    this.textureError = null;
    this.bakeTextureFields.dispose();
    this.textureResolver.dispose();
    this.compute.dispose();
    this.webGpu.dispose();
    super.dispose();
  }

  private scheduleTextureFields(layers: readonly MaterialLayer[]): void {
    const ids = requiredTextureFieldIds(layers);
    const fingerprint = ids.join('|');
    if (fingerprint === this.textureFingerprint) return;
    this.textureFingerprint = fingerprint;
    this.textureError = null;
    const sequence = ++this.textureSequence;

    if (ids.length === 0) {
      this.setTextureFields(new Map());
      this.texturePromise = null;
      return;
    }

    this.texturePromise = this.prepareTextureFields(ids, sequence)
      .catch((error: unknown) => {
        if (sequence !== this.textureSequence) return;
        this.setTextureFields(new Map());
        this.textureError = normalizeError(error, 'Texture-field preparation failed.');
        this.textureFingerprint = FAILED_TEXTURE_FINGERPRINT;
        console.warn('Texture-field preparation failed; using neutral field fallback.', this.textureError);
      })
      .finally(() => {
        if (sequence === this.textureSequence) this.texturePromise = null;
      });
  }

  private async prepareTextureFields(ids: readonly string[], sequence: number): Promise<void> {
    const textures = await Promise.all(ids.map(async (id) => [id, await this.textureResolver.resolve(id)] as const));
    if (sequence !== this.textureSequence) return;
    this.setTextureFields(new Map(textures));
    this.textureError = null;
  }

  private scheduleSimulation(layers: readonly MaterialLayer[]): void {
    const fingerprint = materialSimulationFingerprint(layers, this.algorithmSettings);
    if (fingerprint === this.simulationFingerprint) return;
    this.simulationFingerprint = fingerprint;
    const sequence = ++this.simulationSequence;
    const snapshot = layers.map((layer) => ({ ...layer }));

    if (!materialRequiresSimulation(snapshot)) {
      this.setSimulationAtlas(null);
      this.simulationPromise = null;
      return;
    }

    this.simulationPromise = this.prepareSimulation(snapshot, sequence)
      .catch((error: unknown) => {
        if (sequence !== this.simulationSequence) return;
        this.setSimulationAtlas(null);
        console.warn('Material simulation preparation failed; using analytic fallback.', error);
      })
      .finally(() => {
        if (sequence === this.simulationSequence) this.simulationPromise = null;
      });
  }

  private async prepareSimulation(
    layers: readonly MaterialLayer[],
    sequence: number
  ): Promise<void> {
    await this.compute.initialize();
    const atlas = await buildMaterialSimulationAtlas(this.compute, layers, this.algorithmSettings);
    if (sequence !== this.simulationSequence) {
      atlas?.texture.dispose();
      return;
    }
    this.setSimulationAtlas(
      atlas?.texture ?? null,
      atlas?.readyLayers ?? [],
      atlas?.cellSize ?? 1
    );
  }
}
