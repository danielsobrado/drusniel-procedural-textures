import * as THREE from 'three';
import type { MaterialAlgorithmSettings } from '../core/material/MaterialAlgorithms';
import { DEFAULT_MATERIAL_ALGORITHMS } from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { materialDisplacementExtent } from '../core/material/MaterialDisplacement';
import { DEFAULT_PATTERN_SETTINGS } from '../core/material/PatternSettings';
import { PTL_MAX_LAYERS, PTL_SHADER_DEFAULTS } from '../core/material/runtimeDefaults';
import {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  type TextureFieldChannel,
  type TextureFieldMode
} from '../core/texture/TextureFieldSettings';
import {
  normalizeResolvedTextureField,
  type ResolvedTextureField,
  type TextureFieldResource
} from '../core/texture/ResolvedTextureField';
import { BIOLOGICAL_SSS_LIGHT_GLSL, BIOLOGICAL_SSS_PARS_GLSL } from './BiologicalScattering';
import { PATTERN_KIND_CODE } from './PatternShader';
import type {
  BlendMode,
  LayerChannel,
  LayerKind,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';
import { applyPhysicalSettings } from './PhysicalMaterial';
import {
  DISPLACED_NORMAL_GLSL,
  FRAGMENT_GLSL,
  PHYSICAL_LAYER_GLSL,
  SHADOW_NORMAL_GLSL,
  SHADOW_VERTEX_DISPLACEMENT_GLSL,
  SHARED_GLSL,
  SURFACE_VERTEX_DISPLACEMENT_GLSL
} from './PortableProceduralShader';

const LAYER_KIND_CODE: Record<LayerKind, number> = {
  base: 0,
  fbm: 1,
  cellular: 2,
  ridges: 3,
  spots: 4,
  veins: 5,
  gradient: 6,
  vessels: 7,
  'wet-film': 8,
  sss: 9,
  'reaction-diffusion': 10,
  erosion: 11,
  sdf: 12,
  pattern: 13
};

const BLEND_MODE_CODE: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  add: 2,
  screen: 3,
  overlay: 4
};

const CHANNEL_CODE: Record<LayerChannel, number> = {
  surface: 0,
  color: 1,
  roughness: 2,
  height: 3,
  clearcoat: 4,
  sss: 5,
  metallic: 6,
  ao: 7,
  emissive: 8
};

const TEXTURE_CHANNEL_CODE: Record<TextureFieldChannel, number> = {
  r: 0,
  g: 1,
  b: 2,
  a: 3,
  luminance: 4
};

const TEXTURE_MODE_CODE: Record<TextureFieldMode, number> = {
  replace: 1,
  modulate: 2,
  warp: 3,
  detail: 4
};

const COORDINATE_SPACE_CODE: Record<MaterialCoordinateSpace, number> = {
  object: 0,
  world: 1
};

function createTextureFieldFallback(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([128]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = 'PTL Texture Field Fallback';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function effectiveGroupOpacity(
  groupId: string | null,
  groups: ReadonlyMap<string, MaterialGroup>
): number {
  let opacity = 1;
  let currentId = groupId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (visited.has(currentId)) return 0;
    visited.add(currentId);
    const group = groups.get(currentId);
    if (group === undefined || !group.enabled) return 0;
    opacity *= group.opacity;
    currentId = group.parentId;
  }
  return opacity;
}

function numericPatternValue(
  pattern: Readonly<MaterialLayer['pattern']>,
  key: keyof typeof DEFAULT_PATTERN_SETTINGS
): number {
  const candidate = pattern?.[key];
  const fallback = DEFAULT_PATTERN_SETTINGS[key];
  return typeof candidate === 'number' ? candidate : typeof fallback === 'number' ? fallback : 0;
}

export class SurfaceMaterialCompiler {
  public readonly material: THREE.MeshPhysicalMaterial;
  public readonly depthMaterial = new THREE.MeshDepthMaterial();
  public readonly distanceMaterial = new THREE.MeshDistanceMaterial();

  private displacementExtentValue = 0;
  private simulationAtlas: THREE.Texture | null = null;
  private readonly textureFallback = createTextureFieldFallback();
  private readonly textureIds = new Array<string | null>(PTL_MAX_LAYERS).fill(null);
  private readonly textureRecipeChannels = new Array<number>(PTL_MAX_LAYERS).fill(0);
  private textureFields: ReadonlyMap<string, ResolvedTextureField> = new Map();

  protected readonly uniforms = {
    uLabCount: { value: 0 },
    uLabEnabled: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabLayerKind: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabBlendMode: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabChannel: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabOpacity: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabScale: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabStrength: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabSeed: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabColorA: { value: Array.from({ length: PTL_MAX_LAYERS }, () => new THREE.Color()) },
    uLabColorB: { value: Array.from({ length: PTL_MAX_LAYERS }, () => new THREE.Color()) },
    uLabRoughness: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabDisplacement: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabGroupOpacity: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabMaskIndex: { value: new Array<number>(PTL_MAX_LAYERS).fill(-1) },
    uLabMaskInvert: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabMaskStrength: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabStructureIndex: { value: new Array<number>(PTL_MAX_LAYERS).fill(-1) },
    uLabPatternKind: { value: new Array<number>(PTL_MAX_LAYERS).fill(PATTERN_KIND_CODE.brick) },
    uLabPatternAspect: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.aspect) },
    uLabPatternGap: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.gap) },
    uLabPatternRoundness: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.roundness) },
    uLabPatternJitter: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.jitter) },
    uLabPatternRotation: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.rotation) },
    uLabPatternOffset: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.offset) },
    uLabPatternDensity: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.density) },
    uLabPatternEdgeWear: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.edgeWear) },
    uLabGrassBladeLength: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.bladeLength) },
    uLabGrassBladeWidth: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.bladeWidth) },
    uLabGrassBladeTaper: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.bladeTaper) },
    uLabGrassBladeBend: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.bladeBend) },
    uLabGrassBladeCurvature: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.bladeCurvature) },
    uLabGrassClumpScale: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.clumpScale) },
    uLabGrassClumpStrength: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.clumpStrength) },
    uLabGrassDirectionality: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.directionality) },
    uLabGrassDryness: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.dryness) },
    uLabGrassTipFade: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.tipFade) },
    uLabGrassRootDarkening: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.rootDarkening) },
    uLabGrassHeightJitter: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.heightJitter) },
    uLabGrassWidthJitter: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.widthJitter) },
    uLabGrassLeanJitter: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.leanJitter) },
    uLabTurfFiberLength: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.fiberLength) },
    uLabTurfFiberWidth: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.fiberWidth) },
    uLabTurfFiberBreakup: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.fiberBreakup) },
    uLabTurfFiberSoftness: { value: new Array<number>(PTL_MAX_LAYERS).fill(DEFAULT_PATTERN_SETTINGS.fiberSoftness) },
    uLabTextureFields: { value: Array.from({ length: PTL_MAX_LAYERS }, () => this.textureFallback as THREE.Texture) },
    uLabTextureTransform: { value: Array.from({ length: PTL_MAX_LAYERS }, () => new THREE.Vector4(1, 1, 0, 0)) },
    uLabTextureAdjust: { value: Array.from({ length: PTL_MAX_LAYERS }, () => new THREE.Vector4(0, 1, 0, 0)) },
    uLabTextureChannel: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabTextureClamp: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabTextureMode: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabTextureModeAmount: { value: new Array<number>(PTL_MAX_LAYERS).fill(1) },
    uLabAge: { value: 0 },
    uLabWeathering: { value: 0 },
    uLabGravity: { value: -1 },
    uLabMacro: { value: 1 },
    uLabMeso: { value: 1 },
    uLabMicro: { value: 1 },
    uLabVariation: { value: 0.35 },
    uLabStochasticTiling: { value: 0 },
    uLabCoordinateSpace: { value: COORDINATE_SPACE_CODE.world },
    uLabSimulationAtlas: { value: null as THREE.Texture | null },
    uLabSimulationReady: { value: new Array<number>(PTL_MAX_LAYERS).fill(0) },
    uLabSimulationGrid: { value: new THREE.Vector2(4, 3) },
    uLabSimulationCellSize: { value: 1 },
    uLabSdfRadius: { value: DEFAULT_MATERIAL_ALGORITHMS.sdf.radius },
    uLabSdfBoxSize: { value: DEFAULT_MATERIAL_ALGORITHMS.sdf.boxSize },
    uLabSdfEdgeSoftness: { value: DEFAULT_MATERIAL_ALGORITHMS.sdf.edgeSoftness },
    uLabHasDisplacement: { value: 0 },
    uLabNormalStrength: { value: PTL_SHADER_DEFAULTS.normalStrength },
    uLabSssLightDirection: {
      value: new THREE.Vector3(...PTL_SHADER_DEFAULTS.sssLightDirection).normalize()
    },
    uLabSssBackscatterStrength: { value: PTL_SHADER_DEFAULTS.sssBackscatterStrength },
    uLabSssThicknessScale: { value: PTL_SHADER_DEFAULTS.sssThicknessScale }
  };

  public constructor() {
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.18,
      specularIntensity: 0.62,
      ior: 1.42
    });
    this.configureSurfaceShader();
    this.configureShadowShader(this.depthMaterial, 'depth');
    this.configureShadowShader(this.distanceMaterial, 'distance');
  }

  public get displacementExtent(): number {
    return this.displacementExtentValue;
  }

  public sync(
    layers: readonly MaterialLayer[],
    groups: readonly MaterialGroup[],
    wireframe: boolean,
    synthesis?: Readonly<SynthesisSettings>,
    coordinateSpace: MaterialCoordinateSpace = 'world'
  ): void {
    const count = Math.min(layers.length, PTL_MAX_LAYERS);
    const layerIndexById = new Map(layers.slice(0, count).map((layer, index) => [layer.id, index]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    this.uniforms.uLabCount.value = count;
    this.uniforms.uLabCoordinateSpace.value = COORDINATE_SPACE_CODE[coordinateSpace];
    this.displacementExtentValue = materialDisplacementExtent(layers.slice(0, count), groups);
    let hasDisplacement = false;

    for (let index = 0; index < PTL_MAX_LAYERS; index += 1) {
      const layer = layers[index];
      const active = layer !== undefined;
      const pattern = active ? layer.pattern ?? DEFAULT_PATTERN_SETTINGS : DEFAULT_PATTERN_SETTINGS;
      const textureSettings = active && layer.texture !== null && layer.texture !== undefined
        ? layer.texture
        : DEFAULT_TEXTURE_FIELD_SETTINGS;
      const groupOpacity = active ? effectiveGroupOpacity(layer.groupId, groupById) : 1;
      const maskIndex = active && layer.maskSourceLayerId !== null
        ? layerIndexById.get(layer.maskSourceLayerId) ?? -1
        : -1;
      const structureIndex = active && layer.structureSourceLayerId !== null
        ? layerIndexById.get(layer.structureSourceLayerId) ?? -1
        : -1;

      this.uniforms.uLabEnabled.value[index] = active && layer.enabled ? 1 : 0;
      this.uniforms.uLabLayerKind.value[index] = active ? LAYER_KIND_CODE[layer.kind] : 0;
      this.uniforms.uLabBlendMode.value[index] = active ? BLEND_MODE_CODE[layer.blendMode] : 0;
      this.uniforms.uLabChannel.value[index] = active ? CHANNEL_CODE[layer.channel] : 0;
      this.uniforms.uLabOpacity.value[index] = active ? layer.opacity : 0;
      this.uniforms.uLabScale.value[index] = active ? layer.scale : 1;
      this.uniforms.uLabStrength.value[index] = active ? layer.strength : 1;
      this.uniforms.uLabSeed.value[index] = active ? layer.seed : 1;
      this.uniforms.uLabRoughness.value[index] = active ? layer.roughness : 0;
      this.uniforms.uLabDisplacement.value[index] = active ? layer.displacement : 0;
      this.uniforms.uLabGroupOpacity.value[index] = groupOpacity;
      this.uniforms.uLabMaskIndex.value[index] = maskIndex;
      this.uniforms.uLabMaskInvert.value[index] = active && layer.maskInvert ? 1 : 0;
      this.uniforms.uLabMaskStrength.value[index] = active ? layer.maskStrength : 1;
      this.uniforms.uLabStructureIndex.value[index] = structureIndex;
      this.uniforms.uLabPatternKind.value[index] = PATTERN_KIND_CODE[pattern.kind];
      this.uniforms.uLabPatternAspect.value[index] = pattern.aspect;
      this.uniforms.uLabPatternGap.value[index] = pattern.gap;
      this.uniforms.uLabPatternRoundness.value[index] = pattern.roundness;
      this.uniforms.uLabPatternJitter.value[index] = pattern.jitter;
      this.uniforms.uLabPatternRotation.value[index] = pattern.rotation;
      this.uniforms.uLabPatternOffset.value[index] = pattern.offset;
      this.uniforms.uLabPatternDensity.value[index] = pattern.density;
      this.uniforms.uLabPatternEdgeWear.value[index] = pattern.edgeWear;
      this.uniforms.uLabGrassBladeLength.value[index] = numericPatternValue(pattern, 'bladeLength');
      this.uniforms.uLabGrassBladeWidth.value[index] = numericPatternValue(pattern, 'bladeWidth');
      this.uniforms.uLabGrassBladeTaper.value[index] = numericPatternValue(pattern, 'bladeTaper');
      this.uniforms.uLabGrassBladeBend.value[index] = numericPatternValue(pattern, 'bladeBend');
      this.uniforms.uLabGrassBladeCurvature.value[index] = numericPatternValue(pattern, 'bladeCurvature');
      this.uniforms.uLabGrassClumpScale.value[index] = numericPatternValue(pattern, 'clumpScale');
      this.uniforms.uLabGrassClumpStrength.value[index] = numericPatternValue(pattern, 'clumpStrength');
      this.uniforms.uLabGrassDirectionality.value[index] = numericPatternValue(pattern, 'directionality');
      this.uniforms.uLabGrassDryness.value[index] = numericPatternValue(pattern, 'dryness');
      this.uniforms.uLabGrassTipFade.value[index] = numericPatternValue(pattern, 'tipFade');
      this.uniforms.uLabGrassRootDarkening.value[index] = numericPatternValue(pattern, 'rootDarkening');
      this.uniforms.uLabGrassHeightJitter.value[index] = numericPatternValue(pattern, 'heightJitter');
      this.uniforms.uLabGrassWidthJitter.value[index] = numericPatternValue(pattern, 'widthJitter');
      this.uniforms.uLabGrassLeanJitter.value[index] = numericPatternValue(pattern, 'leanJitter');
      this.uniforms.uLabTurfFiberLength.value[index] = numericPatternValue(pattern, 'fiberLength');
      this.uniforms.uLabTurfFiberWidth.value[index] = numericPatternValue(pattern, 'fiberWidth');
      this.uniforms.uLabTurfFiberBreakup.value[index] = numericPatternValue(pattern, 'fiberBreakup');
      this.uniforms.uLabTurfFiberSoftness.value[index] = numericPatternValue(pattern, 'fiberSoftness');
      this.textureIds[index] = active && layer.texture !== null && layer.texture !== undefined
        ? textureSettings.id
        : null;
      this.uniforms.uLabTextureFields.value[index] = this.textureIds[index] === null
        ? this.textureFallback
        : this.textureFields.get(this.textureIds[index]!)?.texture ?? this.textureFallback;
      this.uniforms.uLabTextureTransform.value[index]?.set(
        textureSettings.scaleX,
        textureSettings.scaleY,
        textureSettings.offsetX,
        textureSettings.offsetY
      );
      this.uniforms.uLabTextureAdjust.value[index]?.set(
        textureSettings.rotation,
        textureSettings.contrast,
        textureSettings.bias,
        textureSettings.invert ? 1 : 0
      );
      const resolvedChannel = this.textureFields.get(textureSettings.id)?.channel ?? textureSettings.channel;
      this.textureRecipeChannels[index] = TEXTURE_CHANNEL_CODE[textureSettings.channel];
      this.uniforms.uLabTextureChannel.value[index] = TEXTURE_CHANNEL_CODE[resolvedChannel];
      this.uniforms.uLabTextureClamp.value[index] = textureSettings.clamp ? 1 : 0;
      this.uniforms.uLabTextureMode.value[index] = active && layer.texture !== null && layer.texture !== undefined
        ? TEXTURE_MODE_CODE[textureSettings.mode]
        : 0;
      this.uniforms.uLabTextureModeAmount.value[index] = textureSettings.modeAmount;
      this.uniforms.uLabColorA.value[index]?.set(active ? layer.colorA : '#000000');
      this.uniforms.uLabColorB.value[index]?.set(active ? layer.colorB : '#000000');

      if (active && layer.enabled && Math.abs(layer.displacement) > 1e-8 && layer.opacity > 0 && groupOpacity > 0) {
        hasDisplacement = true;
      }
    }

    this.uniforms.uLabHasDisplacement.value = hasDisplacement ? 1 : 0;
    if (synthesis !== undefined) {
      this.uniforms.uLabAge.value = synthesis.age;
      this.uniforms.uLabWeathering.value = synthesis.weathering;
      this.uniforms.uLabGravity.value = synthesis.gravity;
      this.uniforms.uLabMacro.value = synthesis.macro;
      this.uniforms.uLabMeso.value = synthesis.meso;
      this.uniforms.uLabMicro.value = synthesis.micro;
      this.uniforms.uLabVariation.value = synthesis.variation;
      this.uniforms.uLabStochasticTiling.value = synthesis.stochasticTiling;
    }
    this.material.wireframe = wireframe;
  }

  public setAlgorithmSettings(settings: Readonly<MaterialAlgorithmSettings>): void {
    this.uniforms.uLabSdfRadius.value = settings.sdf.radius;
    this.uniforms.uLabSdfBoxSize.value = settings.sdf.boxSize;
    this.uniforms.uLabSdfEdgeSoftness.value = settings.sdf.edgeSoftness;
  }

  public setPhysical(settings: Readonly<PhysicalSettings>): void {
    applyPhysicalSettings(this.material, settings);
  }

  public setTextureFields(textures: ReadonlyMap<string, TextureFieldResource>): void {
    this.textureFields = new Map(
      [...textures].map(([id, resource]) => [id, normalizeResolvedTextureField(resource)] as const)
    );
    for (let index = 0; index < PTL_MAX_LAYERS; index += 1) {
      const id = this.textureIds[index] ?? null;
      const binding = id === null ? undefined : this.textureFields.get(id);
      this.uniforms.uLabTextureFields.value[index] = id === null
        ? this.textureFallback
        : binding?.texture ?? this.textureFallback;
      this.uniforms.uLabTextureChannel.value[index] = binding?.channel === undefined
        ? this.textureRecipeChannels[index]!
        : TEXTURE_CHANNEL_CODE[binding.channel];
    }
  }

  public setSimulationAtlas(texture: THREE.Texture | null, readyLayers: readonly boolean[] = [], cellSize = 1): void {
    if (this.simulationAtlas !== null && this.simulationAtlas !== texture) this.simulationAtlas.dispose();
    this.simulationAtlas = texture;
    this.uniforms.uLabSimulationAtlas.value = texture;
    this.uniforms.uLabSimulationCellSize.value = Math.max(1, cellSize);
    for (let index = 0; index < PTL_MAX_LAYERS; index += 1) {
      this.uniforms.uLabSimulationReady.value[index] = readyLayers[index] === true ? 1 : 0;
    }
  }

  public dispose(): void {
    this.simulationAtlas?.dispose();
    this.simulationAtlas = null;
    this.textureFallback.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.distanceMaterial.dispose();
  }

  private configureSurfaceShader(): void {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      const varyings = [
        'varying vec3 vLabPosition;',
        'varying vec3 vLabSurfacePosition;',
        'varying vec3 vLabTriplanarNormal;'
      ].join('\n');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SHARED_GLSL}\n${varyings}`)
        .replace('#include <skinning_vertex>', SURFACE_VERTEX_DISPLACEMENT_GLSL);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHARED_GLSL}\n${FRAGMENT_GLSL}\n${BIOLOGICAL_SSS_PARS_GLSL}\n${varyings}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\nlabTriplanarNormal = normalize(vLabTriplanarNormal);\nLabSurface labSurface = labEvaluateSurface(vLabPosition);\ndiffuseColor.rgb = labSurface.color;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + labSurface.roughness, 0.045, 1.0);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor + labSurface.metallic, 0.0, 1.0);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += labSurface.emissive;`)
        .replace('#include <normal_fragment_begin>', DISPLACED_NORMAL_GLSL)
        .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\n  clearcoatNormal = normalize(normal);\n#endif`)
        .replace('#include <lights_physical_fragment>', PHYSICAL_LAYER_GLSL)
        .replace('#include <lights_fragment_end>', `${BIOLOGICAL_SSS_LIGHT_GLSL}\nreflectedLight.indirectDiffuse *= labSurface.ao;`);
    };
    this.material.customProgramCacheKey = () => 'procedural-texture-lab-surface-v26';
  }

  private configureShadowShader(material: THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial, pass: 'depth' | 'distance'): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SHARED_GLSL}`)
        .replace('#include <begin_vertex>', SHADOW_NORMAL_GLSL)
        .replace('#include <skinning_vertex>', SHADOW_VERTEX_DISPLACEMENT_GLSL);
    };
    material.customProgramCacheKey = () => `procedural-texture-lab-${pass}-v13`;
  }
}
