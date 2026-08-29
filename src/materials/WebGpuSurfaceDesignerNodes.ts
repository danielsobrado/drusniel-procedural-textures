import type { Node } from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  max,
  min,
  mix,
  normalWorldGeometry,
  pow,
  smoothstep,
  step,
  texture,
  vec2,
  vec3
} from 'three/tsl';
import {
  RUNTIME_CELLULAR_CONFIG as cellularConfig,
  RUNTIME_GRASS_PATTERN_CONFIG as grassPatternConfig,
  RUNTIME_STRUCTURED_PATTERN_CONFIG as structuredPatternConfig,
  RUNTIME_TEXTURE_FIELD_CONFIG as textureFieldConfig
} from '../core/material/generated/runtimeConfig';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { DEFAULT_PATTERN_SETTINGS, isStructuredPatternKind } from '../core/material/PatternSettings';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  type TextureFieldChannel
} from '../core/texture/TextureFieldSettings';
import type { ResolvedTextureField } from '../core/texture/ResolvedTextureField';
import { buildWebGpuPatternField } from './WebGpuPatternNodes';
import {
  buildWebGpuFieldWithSynthesis,
  buildWebGpuHeightMask,
  buildWebGpuProceduralLayerMesoField,
  buildWebGpuStochasticDomain,
  buildWebGpuSurfaceNodes as buildLegacySurfaceNodes,
  webGpuTopologyFingerprint as legacyTopologyFingerprint,
  type WebGpuSimulationState,
  type WebGpuSurfaceNodes
} from './WebGpuProceduralNodes';
import type { BlendMode, MaterialLayer } from '../core/material/RuntimeMaterial';
import type { WebGpuMaterialUniforms } from './WebGpuMaterialUniforms';

function isDesignerSourceLayer(layer: Readonly<MaterialLayer>): boolean {
  return layer.kind === 'pattern' || layer.texture !== null && layer.texture !== undefined;
}

function designerLayerIndices(layers: readonly MaterialLayer[]): Set<number> {
  const indexById = new Map(layers.map((layer, index) => [layer.id, index]));
  const indices = new Set<number>();

  layers.forEach((layer, index) => {
    if (isDesignerSourceLayer(layer)) indices.add(index);
  });

  let changed = true;
  while (changed) {
    changed = false;
    layers.forEach((layer, index) => {
      if (indices.has(index)) return;
      const dependencies = [layer.maskSourceLayerId, layer.structureSourceLayerId];
      for (const dependencyId of dependencies) {
        if (dependencyId === null || dependencyId === undefined) continue;
        const dependencyIndex = indexById.get(dependencyId);
        if (dependencyIndex === undefined || !indices.has(dependencyIndex)) continue;
        indices.add(index);
        changed = true;
        break;
      }
    });
  }

  return indices;
}

function withoutSynthesis(uniforms: WebGpuMaterialUniforms): WebGpuMaterialUniforms {
  const zero = float(0);
  return new Proxy(uniforms, {
    get(target, property, receiver) {
      if (property === 'age' || property === 'weathering') return zero;
      return Reflect.get(target, property, receiver) as unknown;
    }
  });
}

function designerDisplacementGain(layer: Readonly<MaterialLayer>): number {
  if (layer.kind === 'cellular') return cellularConfig.displacement.gain;
  if (layer.kind !== 'pattern') return 1;
  const kind = layer.pattern?.kind;
  if (kind === 'grass') return grassPatternConfig.rendering.geometryDisplacementGain;
  if (kind === 'turf') return grassPatternConfig.rendering.turfGeometryDisplacementGain;
  if (kind !== undefined && isStructuredPatternKind(kind)) {
    return structuredPatternConfig.displacementGain[kind];
  }
  return 1;
}

function designerCoverage(
  layer: Readonly<MaterialLayer>,
  shaped: Node<'float'>
): Node<'float'> {
  if (layer.kind === 'base') return float(1);
  if (layer.kind === 'pattern') return smoothstep(0.04, 0.92, shaped);
  if (layer.kind === 'spots' || layer.kind === 'veins' || layer.kind === 'vessels') {
    return smoothstep(0.03, 0.92, shaped);
  }
  if (layer.kind === 'ridges') return mix(0.24, 1, shaped);
  return mix(0.48, 1, shaped);
}

function designerDisplacementSignal(
  layer: Readonly<MaterialLayer>,
  shaped: Node<'float'>
): Node<'float'> {
  return layer.kind === 'spots' ||
    layer.kind === 'veins' ||
    layer.kind === 'vessels' ||
    layer.kind === 'pattern'
    ? shaped
    : shaped.sub(0.5);
}

function blendColor(
  base: Node<'vec3'>,
  layerColor: Node<'vec3'>,
  mode: BlendMode,
  opacity: Node<'float'>
): Node<'vec3'> {
  let blended: Node<'vec3'> = layerColor;
  if (mode === 'multiply') blended = base.mul(layerColor);
  else if (mode === 'add') blended = min(base.add(layerColor), vec3(1));
  else if (mode === 'screen') blended = vec3(1).sub(vec3(1).sub(base).mul(vec3(1).sub(layerColor)));
  else if (mode === 'overlay') {
    const low = base.mul(layerColor).mul(2);
    const high = vec3(1).sub(vec3(1).sub(base).mul(vec3(1).sub(layerColor)).mul(2));
    blended = mix(low, high, step(vec3(0.5), base) as unknown as Node<'float'>) as unknown as Node<'vec3'>;
  }
  return mix(base, blended, clamp(opacity, 0, 1));
}

function textureChannel(value: Node<'vec4'>, channel: TextureFieldChannel): Node<'float'> {
  if (channel === 'g') return value.g;
  if (channel === 'b') return value.b;
  if (channel === 'a') return value.a;
  if (channel === 'luminance') return value.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
  return value.r;
}

function textureFieldForLayer(
  index: number,
  position: Node<'vec3'>,
  triplanarNormal: Node<'vec3'>,
  layer: Readonly<MaterialLayer>,
  uniforms: WebGpuMaterialUniforms,
  textures: ReadonlyMap<string, ResolvedTextureField>
): Node<'float'> {
  const settings = layer.texture ?? DEFAULT_TEXTURE_FIELD_SETTINGS;
  const resolved = textures.get(settings.id);
  if (resolved === undefined) return float(0.5);

  const c = Math.cos(settings.rotation);
  const s = Math.sin(settings.rotation);
  const transformUv = (uv: Node<'vec2'>): Node<'vec2'> => {
    const centered = uv.sub(vec2(0.5));
    return vec2(
      centered.x.mul(c).sub(centered.y.mul(s)),
      centered.x.mul(s).add(centered.y.mul(c))
    ).mul(vec2(settings.scaleX, settings.scaleY))
      .add(vec2(0.5 + settings.offsetX, 0.5 + settings.offsetY));
  };
  const sample = (uv: Node<'vec2'>): Node<'float'> => textureChannel(
    texture(resolved.texture, transformUv(uv)) as unknown as Node<'vec4'>,
    resolved.channel ?? settings.channel
  );
  const seed = uniforms.seed[index]!.add(17);
  const seedOffset = vec3(seed.mul(0.71), seed.mul(1.17), seed.mul(1.91));
  const domain = buildWebGpuStochasticDomain(position, seedOffset, uniforms.stochasticTiling)
    .mul(max(uniforms.scale[index]!.mul(max(uniforms.meso, 0.1)), 0.001))
    .add(seedOffset);
  const minimum = textureFieldConfig.projection.minWeight;
  const sharpness = textureFieldConfig.projection.sharpness;
  const normal = triplanarNormal.normalize();
  const wx = pow(abs(normal.x), sharpness).mul(step(minimum, pow(abs(normal.x), sharpness)));
  const wy = pow(abs(normal.y), sharpness).mul(step(minimum, pow(abs(normal.y), sharpness)));
  const wz = pow(abs(normal.z), sharpness).mul(step(minimum, pow(abs(normal.z), sharpness)));
  const total = max(wx.add(wy).add(wz), 0.000001);
  let field = sample(domain.yz).mul(wx)
    .add(sample(domain.xz).mul(wy))
    .add(sample(domain.xy).mul(wz))
    .div(total);
  field = float(0.5).add(field.sub(0.5).mul(settings.contrast)).add(settings.bias);
  if (settings.invert) field = field.oneMinus();
  return settings.clamp ? clamp(field, 0, 1) : field;
}

function designerGeneratorMesoField(
  index: number,
  position: Node<'vec3'>,
  triplanarNormal: Node<'vec3'>,
  layer: Readonly<MaterialLayer>,
  layers: readonly MaterialLayer[],
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  if (layer.kind !== 'pattern') {
    return buildWebGpuProceduralLayerMesoField(index, position, layers, uniforms, simulation);
  }

  const settings = layer.pattern ?? DEFAULT_PATTERN_SETTINGS;
  const seed = uniforms.seed[index]!.add(17);
  const seedOffset = vec3(seed.mul(0.71), seed.mul(1.17), seed.mul(1.91));
  const domain = buildWebGpuStochasticDomain(position, seedOffset, uniforms.stochasticTiling)
    .mul(max(uniforms.scale[index]!.mul(max(uniforms.meso, 0.1)), 0.001))
    .add(seedOffset);
  const params = uniforms.patternParams(index);
  return buildWebGpuPatternField(domain, settings, params, seed, triplanarNormal);
}

function designerFieldForLayer(
  index: number,
  position: Node<'vec3'>,
  triplanarNormal: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>,
  textures: ReadonlyMap<string, ResolvedTextureField>,
  visited = new Set<number>()
): Node<'float'> {
  if (visited.has(index)) return float(0.5);
  visited.add(index);
  const layer = layers[index];
  if (layer === undefined) return float(0.5);

  if (layer.structureSourceLayerId !== null) {
    const sourceIndex = indexById.get(layer.structureSourceLayerId);
    if (sourceIndex !== undefined) {
      return designerFieldForLayer(
        sourceIndex,
        position,
        triplanarNormal,
        layers,
        indexById,
        uniforms,
        simulation,
        textures,
        visited
      );
    }
  }

  const textureSettings = layer.texture;
  let meso: Node<'float'>;
  if (textureSettings === null || textureSettings === undefined) {
    meso = designerGeneratorMesoField(
      index,
      position,
      triplanarNormal,
      layer,
      layers,
      uniforms,
      simulation
    );
  } else {
    const textureField = textureFieldForLayer(index, position, triplanarNormal, layer, uniforms, textures);
    if (textureSettings.mode === 'replace') {
      meso = textureField;
    } else {
      const safeScale = max(uniforms.scale[index]!.mul(max(uniforms.meso, 0.1)), 0.001);
      const generatorPosition = textureSettings.mode === 'warp'
        ? position.add(vec3(textureField.sub(0.5).mul(textureSettings.modeAmount).div(safeScale)))
        : position;
      const generator = designerGeneratorMesoField(
        index,
        generatorPosition,
        triplanarNormal,
        layer,
        layers,
        uniforms,
        simulation
      );
      if (textureSettings.mode === 'modulate') {
        meso = clamp(
          generator.mul(mix(1, textureField.mul(2), textureSettings.modeAmount)),
          0,
          1
        );
      } else if (textureSettings.mode === 'detail') {
        meso = clamp(generator.add(textureField.sub(0.5).mul(textureSettings.modeAmount)), 0, 1);
      } else {
        meso = generator;
      }
    }
  }
  return buildWebGpuFieldWithSynthesis(meso, index, position, uniforms);
}

function designerMaskForLayer(
  layerIndex: number,
  layer: Readonly<MaterialLayer>,
  position: Node<'vec3'>,
  triplanarNormal: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>,
  textures: ReadonlyMap<string, ResolvedTextureField>
): Node<'float'> {
  if (layer.maskSourceLayerId === null) return float(1);
  const sourceIndex = indexById.get(layer.maskSourceLayerId);
  if (sourceIndex === undefined) return float(1);
  const sourceField = designerFieldForLayer(
    sourceIndex,
    position,
    triplanarNormal,
    layers,
    indexById,
    uniforms,
    simulation,
    textures
  );
  const sourceShaped = clamp(
    float(0.5).add(sourceField.sub(0.5).mul(max(uniforms.strength[sourceIndex]!, 0))),
    0,
    1
  );
  const sourceLayer = layers[sourceIndex];
  const source = layer.maskMode === 'height' && sourceLayer !== undefined
    ? buildWebGpuHeightMask(layerIndex, sourceIndex, sourceLayer.kind, sourceShaped, position, uniforms)
    : sourceShaped;
  const inverted = mix(source, source.oneMinus(), clamp(uniforms.maskInvert[layerIndex]!, 0, 1));
  return mix(1, inverted, clamp(uniforms.maskStrength[layerIndex]!, 0, 1));
}

export function buildWebGpuSurfaceNodes(
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>,
  textures: ReadonlyMap<string, ResolvedTextureField> = new Map(),
  triplanarNormal: Node<'vec3'> = normalWorldGeometry
): WebGpuSurfaceNodes {
  const activeLayers = layers.slice(0, PTL_MAX_LAYERS);
  const designerIndices = designerLayerIndices(activeLayers);
  if (designerIndices.size === 0) {
    return buildLegacySurfaceNodes(position, activeLayers, uniforms, simulation);
  }

  const neutralUniforms = withoutSynthesis(uniforms);
  const synthesisBase = buildLegacySurfaceNodes(position, [], neutralUniforms, simulation);
  const synthesis = buildLegacySurfaceNodes(position, [], uniforms, simulation);
  const synthesisColor = synthesis.color.div(max(synthesisBase.color, vec3(0.0001)));
  const synthesisRoughness = synthesis.roughness.sub(synthesisBase.roughness);
  const synthesisAo = synthesis.ao.div(max(synthesisBase.ao, 0.0001));
  const indexById = new Map(activeLayers.map((layer, index) => [layer.id, index]));
  let color: Node<'vec3'> = vec3(0.42, 0.45, 0.50);
  let roughness: Node<'float'> = float(0);
  let clearcoat: Node<'float'> = float(0);
  let clearcoatRoughness: Node<'float'> = float(0.18);
  let sss: Node<'float'> = float(0);
  let sssColor: Node<'vec3'> = vec3(0);
  let metallic: Node<'float'> = float(0);
  let ao: Node<'float'> = float(1);
  let emissive: Node<'vec3'> = vec3(0);
  let displacement: Node<'float'> = float(0);

  activeLayers.forEach((layer, index) => {
    const field = designerFieldForLayer(
      index,
      position,
      triplanarNormal,
      activeLayers,
      indexById,
      uniforms,
      simulation,
      textures
    );
    const shaped = clamp(float(0.5).add(field.sub(0.5).mul(max(uniforms.strength[index]!, 0))), 0, 1);
    const coverage = designerCoverage(layer, shaped);
    const mask = designerMaskForLayer(
      index,
      layer,
      position,
      triplanarNormal,
      activeLayers,
      indexById,
      uniforms,
      simulation,
      textures
    );
    const opacity = clamp(
      uniforms.enabled[index]!
        .mul(uniforms.opacity[index]!)
        .mul(uniforms.groupOpacity[index]!)
        .mul(mask)
        .mul(coverage),
      0,
      1
    );
    const layerColor = mix(uniforms.colorA[index]!, uniforms.colorB[index]!, shaped);

    if (layer.channel === 'surface' || layer.channel === 'height') {
      displacement = displacement.add(
        designerDisplacementSignal(layer, shaped)
          .mul(uniforms.displacement[index]!)
          .mul(opacity)
          .mul(designerDisplacementGain(layer))
      );
    }
    if (layer.channel === 'surface' || layer.channel === 'color') {
      color = blendColor(color, layerColor, layer.blendMode, opacity);
    }
    if (layer.channel === 'surface' || layer.channel === 'roughness') {
      const weight = layer.kind === 'base'
        ? float(1)
        : mix(0.4, 1, shaped);
      roughness = roughness.add(uniforms.roughness[index]!.mul(opacity).mul(weight));
    }
    if (layer.channel === 'clearcoat') {
      const wetness = clamp(
        opacity.mul(shaped).mul(max(uniforms.strength[index]!, 0)),
        0,
        1
      );
      clearcoat = max(clearcoat, wetness);
      clearcoatRoughness = mix(
        clearcoatRoughness,
        clamp(uniforms.roughness[index]!.mul(0.5).add(shaped.oneMinus().mul(0.18)).add(0.12), 0.02, 1),
        wetness
      );
    }
    if (layer.channel === 'sss') {
      const scatter = clamp(opacity.mul(mix(0.45, 1, shaped)), 0, 1);
      sssColor = sssColor.add(layerColor.mul(scatter));
      sss = sss.add(scatter);
    }
    if (layer.channel === 'metallic') metallic = mix(metallic, shaped, opacity);
    if (layer.channel === 'ao') ao = ao.mul(mix(1, mix(0.35, 1, shaped), opacity));
    if (layer.channel === 'emissive') emissive = emissive.add(layerColor.mul(shaped).mul(opacity));
  });

  return {
    color: color.mul(synthesisColor),
    roughness: roughness.add(synthesisRoughness),
    clearcoat,
    clearcoatRoughness,
    sss: clamp(sss, 0, 1),
    sssColor: sssColor.div(max(sss, 0.0001)),
    metallic,
    ao: ao.mul(synthesisAo),
    emissive,
    displacement
  };
}

export function webGpuTopologyFingerprint(
  layers: readonly MaterialLayer[],
  coordinateSpace: MaterialCoordinateSpace,
  readyLayers: readonly boolean[],
  textures: ReadonlyMap<string, ResolvedTextureField> = new Map()
): string {
  return `${legacyTopologyFingerprint(layers, coordinateSpace, readyLayers)}:${JSON.stringify(
    layers.slice(0, PTL_MAX_LAYERS).map((layer) => ({
      pattern: layer.pattern?.kind ?? null,
      texture: layer.texture ?? null,
      maskSourceLayerId: layer.maskSourceLayerId,
      structureSourceLayerId: layer.structureSourceLayerId,
      resolved: layer.texture === undefined || layer.texture === null
        ? null
        : {
            uuid: textures.get(layer.texture.id)?.texture.uuid ?? null,
            channel: textures.get(layer.texture.id)?.channel ?? layer.texture.channel
          }
    }))
  )}`;
}

export type { WebGpuSimulationState, WebGpuSurfaceNodes } from './WebGpuProceduralNodes';
