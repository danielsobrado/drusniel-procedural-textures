import * as THREE from 'three';
import { MAX_LAYERS, RENDERER_CONFIG } from '../app/constants';
import { BAKE_FRAGMENT_GLSL, BAKE_VERTEX_GLSL } from '../export/TextureBakeShader';
import type {
  BlendMode,
  LayerChannel,
  LayerKind,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings
} from './types';
import {
  DISPLACED_NORMAL_GLSL,
  FRAGMENT_GLSL,
  PHYSICAL_LAYER_GLSL,
  SHADOW_NORMAL_GLSL,
  SHADOW_VERTEX_DISPLACEMENT_GLSL,
  SHARED_GLSL,
  SSS_LIGHT_GLSL,
  SURFACE_VERTEX_DISPLACEMENT_GLSL
} from './ProceduralShader';

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
  sss: 9
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
  sss: 5
};

function effectiveGroupOpacity(
  groupId: string | null,
  groups: ReadonlyMap<string, MaterialGroup>
): number {
  let opacity = 1;
  let currentId = groupId;
  const visited = new Set<string>();

  while (currentId !== null) {
    if (visited.has(currentId)) {
      return 0;
    }
    visited.add(currentId);
    const group = groups.get(currentId);
    if (group === undefined) {
      return 0;
    }
    if (!group.enabled) {
      return 0;
    }
    opacity *= group.opacity;
    currentId = group.parentId;
  }

  return opacity;
}

function routesHeight(channel: LayerChannel): boolean {
  return channel === 'surface' || channel === 'height';
}

export class MaterialCompiler {
  public readonly material: THREE.MeshPhysicalMaterial;
  public readonly depthMaterial = new THREE.MeshDepthMaterial();
  public readonly distanceMaterial = new THREE.MeshDistanceMaterial();

  private displacementExtentValue = 0;
  private readonly uniforms = {
    uLabCount: { value: 0 },
    uLabEnabled: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabLayerKind: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabBlendMode: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabChannel: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabOpacity: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabScale: { value: new Array<number>(MAX_LAYERS).fill(1) },
    uLabStrength: { value: new Array<number>(MAX_LAYERS).fill(1) },
    uLabSeed: { value: new Array<number>(MAX_LAYERS).fill(1) },
    uLabColorA: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Color()) },
    uLabColorB: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Color()) },
    uLabRoughness: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabDisplacement: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabGroupOpacity: { value: new Array<number>(MAX_LAYERS).fill(1) },
    uLabMaskIndex: { value: new Array<number>(MAX_LAYERS).fill(-1) },
    uLabMaskInvert: { value: new Array<number>(MAX_LAYERS).fill(0) },
    uLabMaskStrength: { value: new Array<number>(MAX_LAYERS).fill(1) },
    uLabHasDisplacement: { value: 0 },
    uLabNormalStrength: { value: RENDERER_CONFIG.displacedNormalStrength }
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
    wireframe: boolean
  ): void {
    const count = Math.min(layers.length, MAX_LAYERS);
    const layerIndexById = new Map(layers.slice(0, count).map((layer, index) => [layer.id, index]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    this.uniforms.uLabCount.value = count;
    this.displacementExtentValue = 0;
    let hasDisplacement = false;

    for (let index = 0; index < MAX_LAYERS; index += 1) {
      const layer = layers[index];
      const active = layer !== undefined;
      const groupOpacity = active ? effectiveGroupOpacity(layer.groupId, groupById) : 1;
      const maskIndex = active && layer.maskSourceLayerId !== null
        ? layerIndexById.get(layer.maskSourceLayerId) ?? -1
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
      this.uniforms.uLabColorA.value[index]?.set(active ? layer.colorA : '#000000');
      this.uniforms.uLabColorB.value[index]?.set(active ? layer.colorB : '#000000');

      if (
        active &&
        layer.enabled &&
        routesHeight(layer.channel) &&
        Math.abs(layer.displacement) > 1e-8 &&
        layer.opacity > 0 &&
        groupOpacity > 0
      ) {
        hasDisplacement = true;
        this.displacementExtentValue += Math.abs(layer.displacement) * layer.opacity * groupOpacity * 0.5;
      }
    }

    this.uniforms.uLabHasDisplacement.value = hasDisplacement ? 1 : 0;
    this.material.wireframe = wireframe;
  }

  public createBakeMaterial(settings: Readonly<PhysicalSettings>): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uBakeMode: { value: 0 },
        uBakeBaseRoughness: { value: settings.roughness },
        uBakeBaseClearcoat: { value: settings.clearcoat },
        uBakeBaseClearcoatRoughness: { value: settings.clearcoatRoughness },
        uBakeHeightExtent: { value: Math.max(this.displacementExtentValue, 0.000001) }
      },
      vertexShader: BAKE_VERTEX_GLSL,
      fragmentShader: BAKE_FRAGMENT_GLSL,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false
    });
    material.name = 'Procedural Texture Lab Bake';
    return material;
  }

  public dispose(): void {
    this.material.dispose();
    this.depthMaterial.dispose();
    this.distanceMaterial.dispose();
  }

  private configureSurfaceShader(): void {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\n${SHARED_GLSL}\nvarying vec3 vLabPosition;\nvarying vec3 vLabWorldPosition;`
        )
        .replace('#include <skinning_vertex>', SURFACE_VERTEX_DISPLACEMENT_GLSL);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${SHARED_GLSL}\n${FRAGMENT_GLSL}\nvarying vec3 vLabPosition;\nvarying vec3 vLabWorldPosition;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\nLabSurface labSurface = labEvaluateSurface(vLabPosition);\ndiffuseColor.rgb = labSurface.color;`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + labSurface.roughness, 0.045, 1.0);`
        )
        .replace('#include <normal_fragment_begin>', DISPLACED_NORMAL_GLSL)
        .replace('#include <lights_physical_fragment>', PHYSICAL_LAYER_GLSL)
        .replace('#include <lights_fragment_end>', SSS_LIGHT_GLSL);
    };

    this.material.customProgramCacheKey = () => 'procedural-texture-lab-surface-v5';
  }

  private configureShadowShader(
    material: THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial,
    pass: 'depth' | 'distance'
  ): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SHARED_GLSL}`)
        .replace('#include <begin_vertex>', SHADOW_NORMAL_GLSL)
        .replace('#include <skinning_vertex>', SHADOW_VERTEX_DISPLACEMENT_GLSL);
    };
    material.customProgramCacheKey = () => `procedural-texture-lab-${pass}-v2`;
  }
}
