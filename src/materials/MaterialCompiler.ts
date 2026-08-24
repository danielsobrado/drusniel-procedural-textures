import * as THREE from 'three';
import {
  DEFAULT_MATERIAL_ALGORITHMS,
  type MaterialAlgorithmSettings
} from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { MaterialComputeEngine, type ComputeStatus } from '../engine/MaterialComputeEngine';
import {
  buildMaterialSimulationAtlas,
  materialSimulationFingerprint
} from '../engine/SimulationAtlas';
import {
  BAKE_VERTEX_GLSL,
  createBakeFragmentGlsl,
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
  return layers.some((layer) => !COMPACT_BAKE_KINDS.has(layer.kind)) ? 'portable' : 'compact';
}

export class MaterialCompiler extends SurfaceMaterialCompiler {
  private readonly compute = new MaterialComputeEngine();
  private readonly webGpu = new WebGpuMaterialCompiler();
  private algorithmSettings: MaterialAlgorithmSettings = structuredClone(DEFAULT_MATERIAL_ALGORITHMS);
  private simulationFingerprint = '';
  private simulationSequence = 0;
  private simulationPromise: Promise<void> | null = null;
  private bakeShaderProfile: BakeShaderProfile = 'compact';
  private bakeLayerCount = 1;

  public get renderMaterial(): THREE.Material {
    return this.webGpu.material;
  }

  public get computeStatus(): Readonly<ComputeStatus> {
    return this.compute.status;
  }

  public initializeCompute(): Promise<Readonly<ComputeStatus>> {
    return this.compute.initialize();
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
    this.scheduleSimulation(layers);
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
  }

  public createBakeMaterial(settings: Readonly<PhysicalSettings>): THREE.ShaderMaterial {
    const bakeUniforms = THREE.UniformsUtils.clone(this.uniforms);
    const bakeSimulationAtlas = bakeUniforms.uLabSimulationAtlas?.value;
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
      fragmentShader: createBakeFragmentGlsl(this.bakeShaderProfile, this.bakeLayerCount),
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      toneMapped: false
    });
    material.name = 'Procedural Texture Lab Bake';

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
    this.webGpu.dispose();
    super.dispose();
  }

  private scheduleSimulation(layers: readonly MaterialLayer[]): void {
    const fingerprint = materialSimulationFingerprint(layers, this.algorithmSettings);
    if (fingerprint === this.simulationFingerprint) return;
    this.simulationFingerprint = fingerprint;
    const sequence = ++this.simulationSequence;
    const snapshot = layers.map((layer) => ({ ...layer }));

    if (!snapshot.some((layer) =>
      layer.enabled && (layer.kind === 'reaction-diffusion' || layer.kind === 'erosion')
    )) {
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
