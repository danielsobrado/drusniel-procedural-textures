import * as THREE from 'three';
import { MAX_LAYERS } from '../app/constants';
import type { MaterialGroup, MaterialLayer, PhysicalSettings } from './types';
import { applyPhysicalSettings } from './PhysicalMaterial';
import {
  BAKE_FRAGMENT_GLSL,
  BAKE_VERTEX_GLSL
} from '../export/TextureBakeShader';
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

const LAYER_KIND_CODE: Record<MaterialLayer['kind'], number> = {
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

const BLEND_MODE_CODE: Record<MaterialLayer['blendMode'], number> = {
  normal: 0,
  multiply: 1,
  add: 2,
  screen: 3,
  overlay: 4
};

const CHANNEL_CODE: Record<MaterialLayer['channel'], number> = {
  surface: 0,
  color: 1,
  roughness: 2,
  height: 3,
  clearcoat: 4,
  sss: 5
};

function colorArray(): THREE.Color[] {
  return Array.from({ length: MAX_LAYERS }, () => new THREE.Color('#000000'));
}

function numberArray(value = 0): number[] {
  return Array.from({ length: MAX_LAYERS }, () => value);
}

function groupOpacityFor(groupId: string | null, groups: readonly MaterialGroup[]): number {
  if (groupId === null) return 1;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const visited = new Set<string>();
  let opacity = 1;
  let current = byId.get(groupId);
  while (current !== undefined) {
    if (visited.has(current.id)) return 0;
    visited.add(current.id);
    if (!current.enabled) return 0;
    opacity *= current.opacity;
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return opacity;
}

function routesHeight(channel: MaterialLayer['channel']): boolean {
  return channel === 'surface' || channel === 'height';
}

export class MaterialCompiler {
  public readonly material = new THREE.MeshPhysicalMaterial();
  public readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  public readonly distanceMaterial = new THREE.MeshDistanceMaterial();

  private readonly uniforms: Record<string, THREE.IUniform> = {
    uLabCount: { value: 0 },
    uLabEnabled: { value: numberArray() },
    uLabLayerKind: { value: numberArray() },
    uLabBlendMode: { value: numberArray() },
    uLabChannel: { value: numberArray() },
    uLabOpacity: { value: numberArray() },
    uLabScale: { value: numberArray(1) },
    uLabStrength: { value: numberArray(1) },
    uLabSeed: { value: numberArray() },
    uLabRoughness: { value: numberArray() },
    uLabDisplacement: { value: numberArray() },
    uLabGroupOpacity: { value: numberArray(1) },
    uLabMaskIndex: { value: numberArray(-1) },
    uLabMaskInvert: { value: numberArray() },
    uLabMaskStrength: { value: numberArray(1) },
    uLabColorA: { value: colorArray() },
    uLabColorB: { value: colorArray() },
    uLabHasDisplacement: { value: 0 },
    uLabNormalStrength: { value: 1 }
  };

  private displacementExtentValue = 0;

  public constructor() {
    this.material.color.set('#ffffff');
    this.material.side = THREE.DoubleSide;
    this.material.shadowSide = THREE.DoubleSide;
    this.material.customProgramCacheKey = () => 'procedural-texture-lab-surface-v3';
    this.depthMaterial.customProgramCacheKey = () => 'procedural-texture-lab-depth-v3';
    this.distanceMaterial.customProgramCacheKey = () => 'procedural-texture-lab-distance-v3';

    this.configureSurfaceShader();
    this.configureShadowMaterial(this.depthMaterial);
    this.configureShadowMaterial(this.distanceMaterial);
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
    this.uniforms.uLabCount.value = count;
    this.displacementExtentValue = 0;
    let hasDisplacement = false;

    const activeLayers = layers.slice(0, count);
    const layerIndexById = new Map(activeLayers.map((layer, index) => [layer.id, index]));

    for (let index = 0; index < MAX_LAYERS; index += 1) {
      const layer = activeLayers[index];
      const active = layer !== undefined;
      const groupOpacity = active ? groupOpacityFor(layer.groupId, groups) : 0;
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

  public applyPhysical(settings: Readonly<PhysicalSettings>): void {
    applyPhysicalSettings(this.material, settings);
  }

  public createBakeMaterial(settings: Readonly<PhysicalSettings>): THREE.ShaderMaterial {
    const bakeUniforms = THREE.UniformsUtils.clone(this.uniforms);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...bakeUniforms,
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
      transparent: false,
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
  }

  private configureShadowMaterial(material: THREE.MeshDepthMaterial | THREE.MeshDistanceMaterial): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SHARED_GLSL}`)
        .replace('#include <begin_vertex>', SHADOW_NORMAL_GLSL)
        .replace('#include <skinning_vertex>', SHADOW_VERTEX_DISPLACEMENT_GLSL);
    };
  }
}
