import type { Node } from 'three/webgpu';
import { clamp, float, max, min, mix, smoothstep, step, vec3 } from 'three/tsl';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { DEFAULT_PATTERN_SETTINGS } from '../core/material/PatternSettings';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import { buildWebGpuPatternField } from './WebGpuPatternNodes';
import {
  buildWebGpuProceduralLayerRawField,
  buildWebGpuSurfaceNodes as buildLegacySurfaceNodes,
  webGpuTopologyFingerprint as legacyTopologyFingerprint,
  type WebGpuSimulationState,
  type WebGpuSurfaceNodes
} from './WebGpuProceduralNodes';
import type { BlendMode, MaterialLayer } from './types';
import type { WebGpuMaterialUniforms } from './WebGpuMaterialUniforms';

function withoutPatternLayers(layers: readonly MaterialLayer[]): MaterialLayer[] {
  return layers.map((layer) => layer.kind === 'pattern'
    ? { ...layer, kind: 'base', enabled: false, pattern: null }
    : layer
  );
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

function designerFieldForLayer(
  index: number,
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>,
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
        layers,
        indexById,
        uniforms,
        simulation,
        visited
      );
    }
  }

  if (layer.kind !== 'pattern') {
    return buildWebGpuProceduralLayerRawField(index, position, layers, uniforms, simulation);
  }

  const settings = layer.pattern ?? DEFAULT_PATTERN_SETTINGS;
  const seed = uniforms.seed[index]!.add(17);
  const seedOffset = vec3(seed.mul(0.71), seed.mul(1.17), seed.mul(1.91));
  const domain = position.mul(uniforms.scale[index]!).mul(max(uniforms.meso, 0.1)).add(seedOffset);
  return buildWebGpuPatternField(domain, settings, uniforms.patternParams(index), seed);
}

function patternMaskForLayer(
  layerIndex: number,
  layer: Readonly<MaterialLayer>,
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  if (layer.maskSourceLayerId === null) return float(1);
  const sourceIndex = indexById.get(layer.maskSourceLayerId);
  if (sourceIndex === undefined) return float(1);
  const sourceField = designerFieldForLayer(
    sourceIndex,
    position,
    layers,
    indexById,
    uniforms,
    simulation
  );
  const source = clamp(
    float(0.5).add(sourceField.sub(0.5).mul(max(uniforms.strength[sourceIndex]!, 0))),
    0,
    1
  );
  const inverted = mix(source, source.oneMinus(), clamp(uniforms.maskInvert[layerIndex]!, 0, 1));
  return mix(1, inverted, clamp(uniforms.maskStrength[layerIndex]!, 0, 1));
}

export function buildWebGpuSurfaceNodes(
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): WebGpuSurfaceNodes {
  const activeLayers = layers.slice(0, PTL_MAX_LAYERS);
  const base = buildLegacySurfaceNodes(position, withoutPatternLayers(activeLayers), uniforms, simulation);
  if (!activeLayers.some((layer) => layer.kind === 'pattern')) return base;

  const indexById = new Map(activeLayers.map((layer, index) => [layer.id, index]));
  let color = base.color;
  let roughness = base.roughness;
  let clearcoat = base.clearcoat;
  let clearcoatRoughness = base.clearcoatRoughness;
  let metallic = base.metallic;
  let ao = base.ao;
  let emissive = base.emissive;
  let displacement = base.displacement;

  activeLayers.forEach((layer, index) => {
    if (layer.kind !== 'pattern') return;
    const field = designerFieldForLayer(index, position, activeLayers, indexById, uniforms, simulation);
    const shaped = clamp(float(0.5).add(field.sub(0.5).mul(max(uniforms.strength[index]!, 0))), 0, 1);
    const coverage = smoothstep(0.04, 0.92, shaped);
    const mask = patternMaskForLayer(
      index,
      layer,
      position,
      activeLayers,
      indexById,
      uniforms,
      simulation
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
      displacement = displacement.add(shaped.mul(uniforms.displacement[index]!).mul(opacity));
    }
    if (layer.channel === 'surface' || layer.channel === 'color') {
      color = blendColor(color, layerColor, layer.blendMode, opacity);
    }
    if (layer.channel === 'surface' || layer.channel === 'roughness') {
      roughness = roughness.add(uniforms.roughness[index]!.mul(opacity).mul(mix(0.45, 1, shaped)));
    }
    if (layer.channel === 'clearcoat') {
      const wetness = clamp(opacity.mul(shaped), 0, 1);
      clearcoat = max(clearcoat, wetness);
      clearcoatRoughness = mix(
        clearcoatRoughness,
        clamp(uniforms.roughness[index]!.mul(0.5).add(shaped.oneMinus().mul(0.18)).add(0.12), 0.02, 1),
        wetness
      );
    }
    if (layer.channel === 'metallic') metallic = mix(metallic, shaped, opacity);
    if (layer.channel === 'ao') ao = ao.mul(mix(1, mix(0.35, 1, shaped), opacity));
    if (layer.channel === 'emissive') emissive = emissive.add(layerColor.mul(shaped).mul(opacity));
  });

  return { ...base, color, roughness, clearcoat, clearcoatRoughness, metallic, ao, emissive, displacement };
}

export function webGpuTopologyFingerprint(
  layers: readonly MaterialLayer[],
  coordinateSpace: MaterialCoordinateSpace,
  readyLayers: readonly boolean[]
): string {
  // Only the pattern kind is structural now; the numeric parameters are uniforms, so
  // including them here would rebuild the node tree for a value the shader reads at runtime.
  return `${legacyTopologyFingerprint(layers, coordinateSpace, readyLayers)}:${JSON.stringify(
    layers.slice(0, PTL_MAX_LAYERS).map((layer) => layer.pattern?.kind ?? null)
  )}`;
}

export type { WebGpuSimulationState, WebGpuSurfaceNodes } from './WebGpuProceduralNodes';
