import type { Node, Texture } from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  smoothstep,
  sqrt,
  step,
  texture,
  vec2,
  vec3
} from 'three/tsl';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import {
  SIMULATION_ATLAS_COLUMNS,
  SIMULATION_ATLAS_ROWS
} from '../core/material/SimulationAtlasLayout';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import { cellularConfig } from './CellularConfig';
import type { BlendMode, LayerChannel, LayerKind, MaterialLayer } from './types';
import type { WebGpuMaterialUniforms } from './WebGpuMaterialUniforms';

export interface WebGpuSimulationState {
  texture: Texture;
  readyLayers: readonly boolean[];
  cellSize: number;
}

export interface WebGpuSurfaceNodes {
  color: Node<'vec3'>;
  roughness: Node<'float'>;
  clearcoat: Node<'float'>;
  clearcoatRoughness: Node<'float'>;
  sss: Node<'float'>;
  sssColor: Node<'vec3'>;
  metallic: Node<'float'>;
  ao: Node<'float'>;
  emissive: Node<'vec3'>;
  displacement: Node<'float'>;
}

function hash31(position: Node<'vec3'>): Node<'float'> {
  const p = fract(position.mul(0.1031));
  const mixed = p.add(p.dot(vec3(p.y, p.z, p.x).add(33.33)));
  return fract(mixed.x.add(mixed.y).mul(mixed.z));
}

function hash33(position: Node<'vec3'>): Node<'vec3'> {
  const projected = vec3(
    position.dot(vec3(127.1, 311.7, 74.7)),
    position.dot(vec3(269.5, 183.3, 246.1)),
    position.dot(vec3(113.5, 271.9, 124.6))
  );
  return fract(projected.sin().mul(43758.5453123));
}

function noise3(position: Node<'vec3'>): Node<'float'> {
  const cell = floor(position);
  const local = fract(position);
  const shaped = local.mul(local).mul(vec3(3).sub(local.mul(2)));

  const n000 = hash31(cell.add(vec3(0, 0, 0)));
  const n100 = hash31(cell.add(vec3(1, 0, 0)));
  const n010 = hash31(cell.add(vec3(0, 1, 0)));
  const n110 = hash31(cell.add(vec3(1, 1, 0)));
  const n001 = hash31(cell.add(vec3(0, 0, 1)));
  const n101 = hash31(cell.add(vec3(1, 0, 1)));
  const n011 = hash31(cell.add(vec3(0, 1, 1)));
  const n111 = hash31(cell.add(vec3(1, 1, 1)));

  const nx00 = mix(n000, n100, shaped.x);
  const nx10 = mix(n010, n110, shaped.x);
  const nx01 = mix(n001, n101, shaped.x);
  const nx11 = mix(n011, n111, shaped.x);
  return mix(mix(nx00, nx10, shaped.y), mix(nx01, nx11, shaped.y), shaped.z);
}

function fbm(position: Node<'vec3'>, octaves: 3 | 5): Node<'float'> {
  let value: Node<'float'> = float(0);
  let amplitude = octaves === 3 ? 0.57142857 : 0.5;
  let domain: Node<'vec3'> = position;
  for (let octave = 0; octave < octaves; octave += 1) {
    value = value.add(noise3(domain).mul(amplitude));
    amplitude *= 0.5;
    domain = domain.mul(2.03).add(vec3(7.1, 13.7, 4.9));
  }
  return value;
}

function worleyF1F2Fast(position: Node<'vec3'>): Node<'vec2'> {
  const cell = floor(position);
  const local = fract(position);
  const searchBase = step(vec3(0.5), local).sub(1);
  let nearest: Node<'float'> = float(10);
  let secondNearest: Node<'float'> = float(10);

  for (let x = 0; x <= 1; x += 1) {
    for (let y = 0; y <= 1; y += 1) {
      for (let z = 0; z <= 1; z += 1) {
        const offset = searchBase.add(vec3(x, y, z));
        const jitter = hash33(cell.add(offset)).sub(0.5).mul(cellularConfig.sampling.jitter);
        const point = offset.add(0.5).add(jitter);
        const delta = point.sub(local);
        const distanceSquared = delta.dot(delta);
        secondNearest = min(secondNearest, max(nearest, distanceSquared));
        nearest = min(nearest, distanceSquared);
      }
    }
  }

  return sqrt(vec2(nearest, secondNearest));
}

function organicCellular(position: Node<'vec3'>): Node<'float'> {
  const warpA = noise3(
    position.mul(cellularConfig.warp.scale).add(vec3(3.7, 11.2, 1.9))
  ).sub(0.5);
  const reversed = vec3(position.z, position.y, position.x);
  const warpB = noise3(
    reversed.mul(cellularConfig.warp.scale * 1.09).add(vec3(17.1, 4.3, 9.8))
  ).sub(0.5);
  const warp = vec3(warpA, warpB, warpA.mul(0.52).sub(warpB.mul(0.38)));
  const domain = position.add(warp.mul(cellularConfig.warp.strength));
  const distances = worleyF1F2Fast(domain);
  const gap = max(distances.y.sub(distances.x), 0);
  const dominance = clamp(gap.div(max(distances.y, 0.0001)), 0, 1);

  const asymmetry = noise3(
    domain.mul(cellularConfig.asymmetry.scale).add(vec3(23, 5, 41))
  ).sub(0.5);
  const broadInterior = float(1).sub(smoothstep(0.24, 0.96, distances.x));
  const territory = smoothstep(
    cellularConfig.interior.low,
    cellularConfig.interior.high,
    dominance
  );
  const fused = mix(broadInterior, territory, 0.72);
  const boundaryWidth = Math.max(cellularConfig.interior.low * 2.6, 0.04);
  let boundary: Node<'float'> = float(1).sub(smoothstep(0, boundaryWidth, dominance));
  boundary = boundary.mul(boundary).mul(float(3).sub(boundary.mul(2)));

  const breakup = noise3(
    domain.mul(cellularConfig.breakup.scale).add(vec3(7, 29, 15))
  ).sub(0.5);
  let grown: Node<'float'> = clamp(
    fused
      .add(asymmetry.mul(cellularConfig.asymmetry.strength))
      .add(breakup.mul(cellularConfig.breakup.strength))
      .sub(boundary.mul(cellularConfig.boundary.compression)),
    0,
    1
  );
  grown = grown.mul(grown).mul(float(3).sub(grown.mul(2)));
  return clamp(
    grown.mul(cellularConfig.output.gain).add(cellularConfig.output.floor),
    0,
    1
  );
}

function veinBand(value: Node<'float'>, width: number): Node<'float'> {
  return float(1).sub(smoothstep(width * 0.35, width, abs(value.sub(0.5))));
}

function periodicVeinBand(value: Node<'float'>, width: number | Node<'float'>): Node<'float'> {
  const widthNode = typeof width === 'number' ? float(width) : width;
  return float(1).sub(
    smoothstep(widthNode.mul(0.42), widthNode, abs(fract(value).sub(0.5)))
  );
}

function mineralVeins(position: Node<'vec3'>): Node<'float'> {
  const warpA = fbm(position.mul(0.085).add(vec3(5.1, 17.3, 2.7)), 3).sub(0.5);
  const reversed = vec3(position.z, position.y, position.x);
  const warpB = fbm(reversed.mul(0.11).add(vec3(13.7, 3.9, 9.2)), 3).sub(0.5);
  const domain = position.add(
    vec3(warpA, warpB, warpA.mul(0.36).sub(warpB.mul(0.24))).mul(0.92)
  );

  const primaryNormal = vec3(0.74, 0.18, 0.65).normalize();
  const primaryTangent = vec3(-0.22, 0.97, 0.02).normalize();
  const alongPrimary = domain.dot(primaryTangent);
  const primaryWarp = fbm(domain.mul(0.19).add(vec3(29, 7, 17)), 3)
    .sub(0.5)
    .mul(0.54)
    .add(alongPrimary.mul(0.42).sin().mul(0.07));
  const primaryWidth = mix(
    0.022,
    0.052,
    noise3(domain.mul(0.14).add(vec3(3, 31, 11)))
  );
  const primaryCoordinate = domain.dot(primaryNormal).mul(0.19).add(primaryWarp);
  let primary: Node<'float'> = periodicVeinBand(primaryCoordinate, primaryWidth);
  const primaryHalo = periodicVeinBand(primaryCoordinate, primaryWidth.mul(2.35)).mul(0.26);
  const continuity = smoothstep(
    0.25,
    0.62,
    fbm(domain.mul(0.09).add(vec3(41, 5, 23)), 3)
  );
  primary = primary.mul(mix(0.52, 1, continuity));

  const secondaryNormal = vec3(0.41, -0.31, 0.86).normalize();
  const secondaryCoordinate = domain.dot(secondaryNormal).mul(0.31)
    .add(noise3(domain.mul(0.34).add(vec3(19, 43, 7))).sub(0.5).mul(0.34));
  const secondaryGate = smoothstep(
    0.46,
    0.72,
    fbm(domain.mul(0.12).add(vec3(7, 13, 37)), 3)
  );
  const secondary = periodicVeinBand(secondaryCoordinate, 0.018)
    .mul(secondaryGate)
    .mul(0.72);

  const hairlineNormal = vec3(-0.18, 0.94, 0.28).normalize();
  const hairlineCoordinate = domain.dot(hairlineNormal).mul(0.54)
    .add(noise3(domain.mul(0.61).add(vec3(47, 17, 3))).sub(0.5).mul(0.18));
  const hairlineGate = smoothstep(
    0.58,
    0.76,
    noise3(domain.mul(0.16).add(vec3(11, 53, 29)))
  );
  const hairline = periodicVeinBand(hairlineCoordinate, 0.010)
    .mul(hairlineGate)
    .mul(0.34);

  const mineralDensity = smoothstep(
    0.20,
    0.75,
    fbm(domain.mul(0.055).add(vec3(2, 19, 43)), 3)
  );
  const network = max(primary, max(secondary, hairline));
  return clamp(max(network, primaryHalo).mul(mix(0.68, 1, mineralDensity)), 0, 1);
}

function branchingVessels(position: Node<'vec3'>): Node<'float'> {
  const warpA = fbm(position.mul(0.31).add(vec3(3.1, 8.7, 1.3)), 3).sub(0.5);
  const reversed = vec3(position.z, position.y, position.x);
  const warpB = fbm(reversed.mul(0.29).add(vec3(11.2, 2.4, 7.8)), 3).sub(0.5);
  const domain = position.add(
    vec3(warpA, warpB, warpA.mul(0.55).sub(warpB.mul(0.35))).mul(1.15)
  );
  const trunk = veinBand(fbm(domain.mul(0.62), 3), 0.078);
  const branchA = veinBand(fbm(domain.mul(1.26).add(17), 3), 0.055).mul(0.78);
  const branchB = veinBand(noise3(domain.mul(2.05).add(vec3(31, 7, 19))), 0.046).mul(0.46);
  const territory = smoothstep(0.30, 0.72, fbm(domain.mul(0.18).add(9), 3));
  return clamp(max(trunk, max(branchA, branchB)).mul(territory), 0, 1);
}

function simulationField(
  layerIndex: number,
  position: Node<'vec3'>,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  const column = layerIndex % SIMULATION_ATLAS_COLUMNS;
  const row = Math.floor(layerIndex / SIMULATION_ATLAS_COLUMNS);
  const inset = 0.5 / Math.max(simulation.cellSize, 1);
  const sample = (uv: Node<'vec2'>): Node<'float'> => {
    const local = fract(uv).mul(1 - inset * 2).add(inset);
    const atlasUv = vec2(column, row).add(local).div(vec2(SIMULATION_ATLAS_COLUMNS, SIMULATION_ATLAS_ROWS));
    return texture(simulation.texture, atlasUv).r;
  };
  return sample(position.xy).add(sample(position.xz)).add(sample(position.yz)).div(3);
}

function layerField(
  layerIndex: number,
  kind: LayerKind,
  position: Node<'vec3'>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  const seed = uniforms.seed[layerIndex]!.add(17);
  const scale = uniforms.scale[layerIndex]!;
  const seedOffset = vec3(seed.mul(0.71), seed.mul(1.17), seed.mul(1.91));
  const warpDomain = position.mul(0.5).add(seedOffset.mul(0.031));
  const tileWarp = vec3(
    noise3(warpDomain.add(vec3(11, 3, 7))),
    noise3(warpDomain.add(vec3(23, 17, 5))),
    noise3(warpDomain.add(vec3(2, 29, 19)))
  ).sub(0.5);
  const domain = position.add(tileWarp.mul(uniforms.stochasticTiling));
  const mesoScale = scale.mul(max(uniforms.meso, 0.1));
  const p = domain.mul(max(mesoScale, 0.001)).add(seedOffset);

  if ((kind === 'reaction-diffusion' || kind === 'erosion') && simulation.readyLayers[layerIndex] === true) {
    return simulationField(layerIndex, p.mul(0.08), simulation);
  }
  if (kind === 'base') return float(0.5);
  if (kind === 'fbm') return fbm(p, 5);
  if (kind === 'cellular') return organicCellular(p);
  if (kind === 'ridges') return clamp(float(1).sub(abs(fbm(p, 5).mul(2).sub(1))), 0, 1).pow(2.2);
  if (kind === 'spots') return smoothstep(0.58, 0.78, fbm(p, 5));
  if (kind === 'veins') return mineralVeins(p);
  if (kind === 'gradient') return clamp(position.y.mul(0.5).add(0.5), 0, 1);
  if (kind === 'vessels') return branchingVessels(p);
  if (kind === 'wet-film') return smoothstep(0.30, 0.72, fbm(p.mul(0.7).add(vec3(4, 12, 7)), 3));
  if (kind === 'sss') return smoothstep(0.18, 0.82, fbm(p.mul(0.55).add(vec3(13, 3, 21)), 3));
  if (kind === 'reaction-diffusion') {
    const q = p.add(fbm(p.mul(0.21), 3).sub(0.5).mul(2.1));
    const activator = q.x.mul(1.7).add(q.y.mul(1.3).sin()).sin()
      .mul(q.z.mul(1.1).sub(q.y.mul(0.7)).cos());
    const inhibitor = fbm(q.mul(0.38).add(19), 3);
    return smoothstep(-0.28, 0.38, activator.mul(0.62).add(inhibitor).sub(0.5));
  }
  if (kind === 'erosion') {
    const terrain = fbm(p.mul(0.31), 3);
    const talus = float(1).sub(abs(fbm(p.mul(0.82).add(7), 3).mul(2).sub(1)));
    const sediment = smoothstep(
      0.18,
      0.72,
      terrain.sub(talus.mul(0.31)).add(domain.y.mul(uniforms.gravity).mul(0.08))
    );
    return mix(terrain, sediment, 0.72);
  }

  const cell = fract(p).sub(0.5);
  const sphere = cell.length().sub(uniforms.sdfRadius);
  const box = max(abs(cell).sub(vec3(uniforms.sdfBoxSize)), vec3(0)).length().sub(uniforms.sdfEdgeSoftness);
  const sdf = mix(sphere, box, hash31(floor(p)));
  return float(1).sub(smoothstep(uniforms.sdfEdgeSoftness.negate(), uniforms.sdfEdgeSoftness.mul(3), sdf));
}

function layerIndexById(layers: readonly MaterialLayer[]): Map<string, number> {
  return new Map(layers.slice(0, PTL_MAX_LAYERS).map((layer, index) => [layer.id, index]));
}

function resolveStructureIndex(
  layerIndex: number,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>
): number {
  let current = layerIndex;
  const visited = new Set<number>();
  for (let depth = 0; depth < PTL_MAX_LAYERS; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const sourceId = layers[current]?.structureSourceLayerId;
    if (sourceId === null || sourceId === undefined) break;
    const sourceIndex = indexById.get(sourceId);
    if (sourceIndex === undefined) break;
    current = sourceIndex;
  }
  return current;
}

function fieldForLayer(
  layerIndex: number,
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  const fieldIndex = resolveStructureIndex(layerIndex, layers, indexById);
  const fieldLayer = layers[fieldIndex];
  if (fieldLayer === undefined) return float(0.5);
  const meso = layerField(fieldIndex, fieldLayer.kind, position, uniforms, simulation);
  const seed = uniforms.seed[fieldIndex]!;
  const scale = uniforms.scale[fieldIndex]!;
  const seedOffset = vec3(seed.mul(0.71), seed.mul(1.17), seed.mul(1.91));
  const macro = noise3(position.mul(scale).mul(max(uniforms.macro, 0.1)).mul(0.24).add(seedOffset));
  const micro = noise3(position.mul(scale).mul(max(uniforms.micro, 0.1)).mul(4.7).add(seedOffset).add(41));
  return clamp(
    mix(meso, macro, uniforms.variation.mul(0.22).add(0.24)).add(micro.sub(0.5).mul(0.16)),
    0,
    1
  );
}

function shapedField(field: Node<'float'>, strength: Node<'float'>): Node<'float'> {
  return clamp(float(0.5).add(field.sub(0.5).mul(max(strength, 0))), 0, 1);
}

function coverage(kind: LayerKind, shaped: Node<'float'>): Node<'float'> {
  if (kind === 'base') return float(1);
  if (kind === 'spots' || kind === 'veins' || kind === 'vessels') return smoothstep(0.03, 0.92, shaped);
  if (kind === 'ridges') return mix(0.24, 1, shaped);
  return mix(0.48, 1, shaped);
}

function displacementSignal(kind: LayerKind, shaped: Node<'float'>): Node<'float'> {
  return kind === 'spots' || kind === 'veins' || kind === 'vessels' ? shaped : shaped.sub(0.5);
}

function displacementGain(kind: LayerKind): number {
  return kind === 'cellular' ? cellularConfig.displacement.gain : 1;
}

function maskForLayer(
  layerIndex: number,
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  const sourceId = layers[layerIndex]?.maskSourceLayerId;
  if (sourceId === null || sourceId === undefined) return float(1);
  const sourceIndex = indexById.get(sourceId);
  if (sourceIndex === undefined) return float(1);
  const sourceField = fieldForLayer(sourceIndex, position, layers, indexById, uniforms, simulation);
  const shaped = shapedField(sourceField, uniforms.strength[sourceIndex]!);
  const inverted = mix(shaped, shaped.oneMinus(), uniforms.maskInvert[layerIndex]!);
  return mix(1, inverted, clamp(uniforms.maskStrength[layerIndex]!, 0, 1));
}

function effectiveOpacity(
  layerIndex: number,
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  indexById: ReadonlyMap<string, number>,
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): Node<'float'> {
  return clamp(
    uniforms.enabled[layerIndex]!
      .mul(uniforms.opacity[layerIndex]!)
      .mul(uniforms.groupOpacity[layerIndex]!)
      .mul(maskForLayer(layerIndex, position, layers, indexById, uniforms, simulation)),
    0,
    1
  );
}

function routesHeight(channel: LayerChannel): boolean {
  return channel === 'surface' || channel === 'height';
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

export function buildWebGpuSurfaceNodes(
  position: Node<'vec3'>,
  layers: readonly MaterialLayer[],
  uniforms: WebGpuMaterialUniforms,
  simulation: Readonly<WebGpuSimulationState>
): WebGpuSurfaceNodes {
  const activeLayers = layers.slice(0, PTL_MAX_LAYERS);
  const indexById = layerIndexById(activeLayers);
  let surfaceColor: Node<'vec3'> = vec3(0.42, 0.45, 0.50);
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
    const opacityBase = effectiveOpacity(index, position, activeLayers, indexById, uniforms, simulation);
    const field = fieldForLayer(index, position, activeLayers, indexById, uniforms, simulation);
    const shaped = shapedField(field, uniforms.strength[index]!);
    const layerCoverage = coverage(layer.kind, shaped);
    const opacity = clamp(opacityBase.mul(layerCoverage), 0, 1);
    const layerColor = mix(uniforms.colorA[index]!, uniforms.colorB[index]!, shaped);

    if (routesHeight(layer.channel)) {
      displacement = displacement.add(
        displacementSignal(layer.kind, shaped)
          .mul(uniforms.displacement[index]!)
          .mul(displacementGain(layer.kind))
          .mul(opacityBase)
          .mul(layerCoverage)
      );
    }
    if (layer.channel === 'surface' || layer.channel === 'color') {
      surfaceColor = blendColor(surfaceColor, layerColor, layer.blendMode, opacity);
    }
    if (layer.channel === 'surface' || layer.channel === 'roughness') {
      const weight = layer.kind === 'base' ? float(1) : mix(0.4, 1, shaped);
      roughness = roughness.add(uniforms.roughness[index]!.mul(opacity).mul(weight));
    }
    if (layer.channel === 'clearcoat') {
      const wetness = clamp(opacity.mul(shaped).mul(max(uniforms.strength[index]!, 0)), 0, 1);
      const target = clamp(
        uniforms.roughness[index]!.mul(0.5).add(shaped.oneMinus().mul(0.18)).add(0.12),
        0.02,
        1
      );
      clearcoat = max(clearcoat, wetness);
      clearcoatRoughness = mix(clearcoatRoughness, target, wetness);
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

  const ageMask = clamp(uniforms.age.mul(uniforms.weathering), 0, 1);
  const gravityStain = smoothstep(
    0.25,
    0.82,
    fbm(position.mul(0.43).add(vec3(0, uniforms.gravity.mul(7), 0)), 3)
  );
  surfaceColor = surfaceColor.mul(mix(1, gravityStain.mul(0.18).add(0.62), ageMask));
  roughness = roughness.add(ageMask.mul(mix(0.03, 0.18, gravityStain)));
  ao = ao.mul(float(1).sub(ageMask.mul(gravityStain.oneMinus()).mul(0.22)));
  const safeSss = max(sss, 0.0001);

  return {
    color: surfaceColor,
    roughness,
    clearcoat,
    clearcoatRoughness,
    sss: clamp(sss, 0, 1),
    sssColor: sssColor.div(safeSss),
    metallic,
    ao: clamp(ao, 0, 1),
    emissive,
    displacement
  };
}

export function webGpuTopologyFingerprint(
  layers: readonly MaterialLayer[],
  coordinateSpace: MaterialCoordinateSpace,
  readyLayers: readonly boolean[]
): string {
  return JSON.stringify({
    coordinateSpace,
    layers: layers.slice(0, PTL_MAX_LAYERS).map((layer) => ({
      kind: layer.kind,
      channel: layer.channel,
      blendMode: layer.blendMode,
      maskSourceLayerId: layer.maskSourceLayerId,
      structureSourceLayerId: layer.structureSourceLayerId
    })),
    readyLayers: readyLayers.slice(0, PTL_MAX_LAYERS)
  });
}
