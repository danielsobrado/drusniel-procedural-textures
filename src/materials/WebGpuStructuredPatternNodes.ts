import type { Node } from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  normalWorldGeometry,
  pow,
  smoothstep,
  vec2
} from 'three/tsl';
import { RUNTIME_STRUCTURED_PATTERN_CONFIG as structuredPatternConfig } from '../core/material/generated/runtimeConfig';
import type { PatternSettings } from '../core/material/PatternSettings';
import type { PatternParamNodes } from './WebGpuPatternNodes';

function hash21(position: Node<'vec2'>, seed: Node<'float'>): Node<'float'> {
  return fract(
    position.dot(vec2(127.1, 311.7)).add(seed.mul(74.7)).sin().mul(43758.5453123)
  );
}

function valueNoise2(position: Node<'vec2'>, seed: Node<'float'>): Node<'float'> {
  const cell = floor(position);
  const local = fract(position);
  const smoothLocal = local.mul(local).mul(vec2(3).sub(local.mul(2)));
  const a = hash21(cell, seed);
  const b = hash21(cell.add(vec2(1, 0)), seed);
  const c = hash21(cell.add(vec2(0, 1)), seed);
  const d = hash21(cell.add(vec2(1, 1)), seed);
  return mix(mix(a, b, smoothLocal.x), mix(c, d, smoothLocal.x), smoothLocal.y);
}

function rotate(position: Node<'vec2'>, angle: Node<'float'>): Node<'vec2'> {
  const cosine = angle.cos();
  const sine = angle.sin();
  return vec2(
    position.x.mul(cosine).sub(position.y.mul(sine)),
    position.x.mul(sine).add(position.y.mul(cosine))
  );
}

function roundedCell(
  local: Node<'vec2'>,
  params: PatternParamNodes,
  wear: Node<'float'>
): Node<'float'> {
  const q = max(abs(local).sub(params.cellInnerHalf), vec2(0));
  return float(1).sub(
    smoothstep(-0.014, 0.032, q.length().sub(params.cellRadius).add(wear))
  );
}

function structuredCell(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): { local: Node<'vec2'>; cell: Node<'vec2'>; randomA: Node<'float'>; randomB: Node<'float'> } {
  let domain = rotate(coordinate, params.rotationRadians);
  domain = vec2(domain.x.div(params.aspectDivisor), domain.y);
  const row = floor(domain.y);
  const parity = fract(row.mul(0.5)).mul(2);
  const courseWarp = hash21(vec2(row, 0), seed.add(211))
    .sub(0.5)
    .mul(params.cellJitterOffset)
    .mul(0.75);
  const bondOffset = settings.kind === 'tile' ? float(0) : parity.mul(params.offset);
  domain = vec2(domain.x.add(bondOffset).add(courseWarp), domain.y);
  const cell = floor(domain);
  const randomA = hash21(cell, seed);
  const randomB = hash21(cell.add(31), seed.add(5));
  const jitterScale = settings.kind === 'brick' ? 0.55 : settings.kind === 'plank' ? 0.42 : 0.28;
  const local = fract(domain).sub(0.5).sub(
    vec2(randomA, randomB).sub(0.5).mul(params.cellJitterOffset).mul(jitterScale)
  );
  return { local, cell, randomA, randomB };
}

function brick2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const sample = structuredCell(coordinate, settings, params, seed);
  const wearNoise = valueNoise2(sample.local.mul(5.7).add(sample.cell.mul(0.23)), seed.add(271));
  const wear = wearNoise.sub(0.5).mul(params.grassEdgeWear).mul(0.055);
  let face = roundedCell(sample.local, params, wear);
  const halfSize = params.cellInnerHalf.add(params.cellRadius);
  const edgeDistance = min(
    halfSize.sub(abs(sample.local.x)),
    halfSize.sub(abs(sample.local.y))
  );
  const innerEdge = max(edgeDistance, 0);
  const bevel = smoothstep(0.008, 0.13, innerEdge);
  const chipBand = float(1).sub(smoothstep(0.012, 0.135, innerEdge));
  const chipNoise = valueNoise2(sample.local.mul(10.5).add(sample.cell.mul(0.41)), seed.add(307));
  const chips = smoothstep(0.72, 0.92, chipNoise.add(params.grassEdgeWear.mul(0.18)))
    .mul(chipBand)
    .mul(params.grassEdgeWear);
  face = face.mul(float(1).sub(chips));
  const clayNoise = valueNoise2(sample.local.mul(4.8).add(sample.cell.mul(0.19)), seed.add(401));
  const faceProfile = mix(0.68, 1, bevel)
    .mul(mix(0.93, 1.035, clayNoise))
    .mul(mix(0.94, 1.035, sample.randomB));
  return clamp(face.mul(faceProfile), 0, 1);
}

function tile2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const sample = structuredCell(coordinate, settings, params, seed);
  const face = roundedCell(sample.local, params, float(0));
  const halfSize = params.cellInnerHalf.add(params.cellRadius);
  const edgeDistance = min(
    halfSize.sub(abs(sample.local.x)),
    halfSize.sub(abs(sample.local.y))
  );
  const bevel = smoothstep(0.004, 0.09, max(edgeDistance, 0));
  const glazeUndulation = valueNoise2(sample.local.mul(3.2).add(sample.cell.mul(0.13)), seed.add(433));
  return clamp(face.mul(mix(0.82, 1, bevel)).mul(mix(0.985, 1.015, glazeUndulation)), 0, 1);
}

function plank2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const sample = structuredCell(coordinate, settings, params, seed);
  const edgeNoise = valueNoise2(sample.local.mul(7.5).add(sample.cell.mul(0.31)), seed.add(457));
  const mask = roundedCell(
    sample.local,
    params,
    edgeNoise.sub(0.5).mul(params.grassEdgeWear).mul(0.035)
  );
  const halfSize = params.cellInnerHalf.add(params.cellRadius);
  const edgeDistance = min(
    halfSize.sub(abs(sample.local.x)),
    halfSize.sub(abs(sample.local.y))
  );
  const bevel = smoothstep(0.004, 0.105, max(edgeDistance, 0));
  const grain = valueNoise2(
    vec2(sample.local.x.mul(12).add(sample.cell.x.mul(1.9)), sample.local.y.mul(2.2)),
    seed.add(503)
  );
  const cup = float(1).sub(abs(sample.local.y).mul(0.12));
  return clamp(
    mask.mul(mix(0.76, 1, bevel)).mul(cup).mul(mix(0.94, 1.025, grain)).mul(mix(0.93, 1.04, sample.randomB)),
    0,
    1
  );
}

function roofTile2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const sample = structuredCell(coordinate, settings, params, seed);
  const mask = roundedCell(
    sample.local,
    params,
    sample.randomA.sub(0.5).mul(params.grassEdgeWear).mul(0.018)
  );
  const barrel = sample.local.x.mul(Math.PI).cos().mul(0.46).add(0.54);
  const overlap = smoothstep(-0.46, -0.08, sample.local.y);
  const lowerLip = smoothstep(0.28, 0.49, sample.local.y).mul(0.08);
  const sideSoftening = float(1).sub(smoothstep(0.38, 0.5, abs(sample.local.x)).mul(0.18));
  return clamp(
    mask.mul(barrel).mul(mix(0.76, 1, overlap)).mul(sideSoftening).add(lowerLip.mul(mask)),
    0,
    1
  );
}

function fabric2d(
  coordinate: Node<'vec2'>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const domain = rotate(coordinate, params.rotationRadians).mul(params.density);
  const column = floor(domain.x);
  const row = floor(domain.y);
  const warpWidth = params.fabricWidth.mul(mix(0.88, 1.12, hash21(vec2(column, 0), seed.add(541))));
  const weftWidth = params.fabricWidth.mul(mix(0.88, 1.12, hash21(vec2(row, 0), seed.add(557))));
  const warpWaviness = valueNoise2(vec2(domain.y.mul(0.2), column.mul(0.13)), seed.add(571)).sub(0.5).mul(0.12);
  const weftWaviness = valueNoise2(vec2(domain.x.mul(0.2), row.mul(0.13)), seed.add(587)).sub(0.5).mul(0.12);
  const warpDistance = abs(fract(domain.x.add(warpWaviness)).sub(0.5));
  const weftDistance = abs(fract(domain.y.add(weftWaviness)).sub(0.5));
  const warp = float(1).sub(smoothstep(warpWidth, warpWidth.add(0.028), warpDistance));
  const weft = float(1).sub(smoothstep(weftWidth, weftWidth.add(0.028), weftDistance));
  const parity = fract(column.add(row).mul(0.5)).mul(2);
  const crossing = mix(max(warp.mul(0.7), weft), max(warp, weft.mul(0.7)), parity);
  const fiberNoise = valueNoise2(domain.mul(0.37), seed.add(601));
  return clamp(crossing.mul(mix(0.92, 1.04, fiberNoise)), 0, 1);
}

function pebbleSample(
  domain: Node<'vec2'>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const cell = floor(domain);
  let local = fract(domain).sub(0.5);
  const randomA = hash21(cell, seed);
  const randomB = hash21(cell.add(23), seed.add(3));
  local = local.sub(vec2(randomA, randomB).sub(0.5).mul(params.pebbleJitterOffset));
  local = rotate(local, randomB.sub(0.5).mul(params.pebbleJitterRotate));
  const radius = mix(0.25, 0.44, randomA).mul(params.pebbleRadiusScale);
  const normalized = vec2(local.x.div(params.pebbleXScale), local.y);
  const surfaceNoise = valueNoise2(local.mul(6.4).add(cell.mul(0.23)), seed.add(619));
  const distance = normalized.length().sub(radius).add(surfaceNoise.sub(0.5).mul(params.pebbleWear));
  const mask = float(1).sub(smoothstep(-0.018, 0.034, distance));
  const dome = clamp(float(1).sub(normalized.length().div(max(radius, 0.001))), 0, 1);
  return mask.mul(mix(0.48, 1, dome.sqrt()));
}

function pebble2d(
  coordinate: Node<'vec2'>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const baseDomain = rotate(coordinate, params.rotationRadians).mul(params.density);
  const primary = pebbleSample(baseDomain, params, seed);
  const secondary = pebbleSample(baseDomain.mul(1.31).add(vec2(0.41, 0.23)), params, seed.add(37)).mul(0.88);
  return clamp(max(primary, secondary), 0, 1);
}

function pattern2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  if (settings.kind === 'brick') return brick2d(coordinate, settings, params, seed);
  if (settings.kind === 'tile') return tile2d(coordinate, settings, params, seed);
  if (settings.kind === 'plank') return plank2d(coordinate, settings, params, seed);
  if (settings.kind === 'roof-tile') return roofTile2d(coordinate, settings, params, seed);
  if (settings.kind === 'fabric') return fabric2d(coordinate, params, seed);
  return pebble2d(coordinate, params, seed);
}

export function buildWebGpuStructuredPatternField(
  position: Node<'vec3'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const xy = pattern2d(position.xy, settings, params, seed);
  const xz = pattern2d(position.xz, settings, params, seed.add(11));
  const yz = pattern2d(position.yz, settings, params, seed.add(23));
  const sharpness = structuredPatternConfig.projection.sharpness;
  const wx = pow(abs(normalWorldGeometry.x), sharpness);
  const wy = pow(abs(normalWorldGeometry.y), sharpness);
  const wz = pow(abs(normalWorldGeometry.z), sharpness);
  const total = max(wx.add(wy).add(wz), 0.0001);
  const weighted = yz.mul(wx).add(xz.mul(wy)).add(xy.mul(wz)).div(total);
  return clamp(weighted, 0, 1);
}
