import type { Node } from 'three/webgpu';
import { abs, clamp, float, floor, fract, max, min, mix, pow, smoothstep, step, vec2, vec3 } from 'three/tsl';
import {
  RUNTIME_GRASS_PATTERN_CONFIG as grassPatternConfig,
  RUNTIME_STRUCTURED_PATTERN_CONFIG as structuredPatternConfig
} from '../core/material/generated/runtimeConfig';
import {
  DEFAULT_PATTERN_SETTINGS,
  type PatternSettings
} from '../core/material/PatternSettings';

export interface PatternParamNodes {
  rotationRadians: Node<'float'>;
  density: Node<'float'>;
  grassJitterOffset: Node<'float'>;
  grassBladeLength: Node<'float'>;
  grassBladeWidth: Node<'float'>;
  grassBladeTaper: Node<'float'>;
  grassBladeBend: Node<'float'>;
  grassBladeCurvature: Node<'float'>;
  grassClumpScale: Node<'float'>;
  grassClumpStrength: Node<'float'>;
  grassDirectionality: Node<'float'>;
  grassDryness: Node<'float'>;
  grassTipFade: Node<'float'>;
  grassRootDarkening: Node<'float'>;
  grassHeightJitter: Node<'float'>;
  grassWidthJitter: Node<'float'>;
  grassLeanJitter: Node<'float'>;
  grassEdgeWear: Node<'float'>;
  turfFiberLength: Node<'float'>;
  turfFiberWidth: Node<'float'>;
  turfFiberBreakup: Node<'float'>;
  turfFiberSoftness: Node<'float'>;
  pebbleJitterOffset: Node<'float'>;
  pebbleJitterRotate: Node<'float'>;
  pebbleRadiusScale: Node<'float'>;
  pebbleXScale: Node<'float'>;
  pebbleWear: Node<'float'>;
  fabricWidth: Node<'float'>;
  fabricWidthUpper: Node<'float'>;
  aspectDivisor: Node<'float'>;
  offset: Node<'float'>;
  cellJitterOffset: Node<'float'>;
  cellInnerHalf: Node<'float'>;
  cellRadius: Node<'float'>;
  cellWear: Node<'float'>;
}

export type PatternParamValues = Record<keyof PatternParamNodes, number>;

function patternValue(settings: Readonly<PatternSettings>, key: keyof typeof DEFAULT_PATTERN_SETTINGS): number {
  const value = settings[key];
  const fallback = DEFAULT_PATTERN_SETTINGS[key];
  return typeof value === 'number' ? value : typeof fallback === 'number' ? fallback : 0;
}

export function derivePatternParams(settings: Readonly<PatternSettings>): PatternParamValues {
  const inset = Math.min(settings.gap * 0.5, 0.225);
  const half = 0.5 - inset;
  const radius = Math.min(settings.roundness, 0.5) * half;
  const fabricWidth = Math.max(0.08, Math.min(0.48, 0.5 - settings.gap * 0.7));
  const aspectAtLeastOne = Math.max(settings.aspect, 1);

  return {
    rotationRadians: settings.rotation * Math.PI,
    density: settings.density,
    grassJitterOffset: settings.jitter * 0.26,
    grassBladeLength: patternValue(settings, 'bladeLength'),
    grassBladeWidth: patternValue(settings, 'bladeWidth'),
    grassBladeTaper: patternValue(settings, 'bladeTaper'),
    grassBladeBend: patternValue(settings, 'bladeBend'),
    grassBladeCurvature: patternValue(settings, 'bladeCurvature'),
    grassClumpScale: patternValue(settings, 'clumpScale'),
    grassClumpStrength: patternValue(settings, 'clumpStrength'),
    grassDirectionality: patternValue(settings, 'directionality'),
    grassDryness: patternValue(settings, 'dryness'),
    grassTipFade: patternValue(settings, 'tipFade'),
    grassRootDarkening: patternValue(settings, 'rootDarkening'),
    grassHeightJitter: patternValue(settings, 'heightJitter'),
    grassWidthJitter: patternValue(settings, 'widthJitter'),
    grassLeanJitter: patternValue(settings, 'leanJitter'),
    grassEdgeWear: settings.edgeWear,
    turfFiberLength: patternValue(settings, 'fiberLength'),
    turfFiberWidth: patternValue(settings, 'fiberWidth'),
    turfFiberBreakup: patternValue(settings, 'fiberBreakup'),
    turfFiberSoftness: patternValue(settings, 'fiberSoftness'),
    pebbleJitterOffset: settings.jitter * 0.38,
    pebbleJitterRotate: Math.PI * settings.jitter,
    pebbleRadiusScale: 1 - settings.gap * 0.55,
    pebbleXScale: aspectAtLeastOne === 1 ? 1 : 0.72 + 0.28 / aspectAtLeastOne,
    pebbleWear: settings.edgeWear * 0.04,
    fabricWidth,
    fabricWidthUpper: fabricWidth + 0.035,
    aspectDivisor: Math.max(settings.aspect, 0.05),
    offset: settings.offset,
    cellJitterOffset: settings.jitter * 0.16,
    cellInnerHalf: half - radius,
    cellRadius: radius,
    cellWear: settings.edgeWear * 0.05
  };
}

function hash21(position: Node<'vec2'>, seed: Node<'float'>): Node<'float'> {
  const p = fract(vec3(position, seed.mul(0.173)).mul(0.1031));
  const mixed = p.add(p.dot(vec3(p.y, p.z, p.x).add(33.33)));
  return fract(mixed.x.add(mixed.y).mul(mixed.z));
}

function hash31(position: Node<'vec3'>): Node<'float'> {
  const p = fract(position.mul(0.1031));
  const mixed = p.add(p.dot(vec3(p.y, p.z, p.x).add(33.33)));
  return fract(mixed.x.add(mixed.y).mul(mixed.z));
}

function noise3(position: Node<'vec3'>): Node<'float'> {
  const cell = floor(position);
  const local = fract(position);
  const shaped = local.mul(local).mul(vec3(3).sub(local.mul(2)));
  const n000 = hash31(cell);
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
    position.x.mul(cosine).add(position.y.mul(sine)),
    position.y.mul(cosine).sub(position.x.mul(sine))
  );
}

function roundedCell(
  local: Node<'vec2'>,
  params: PatternParamNodes,
  randomValue: Node<'float'>
): Node<'float'> {
  const signed = abs(local).sub(max(params.cellInnerHalf, 0.001));
  const distance = max(signed, vec2(0)).length()
    .add(min(max(signed.x, signed.y), 0))
    .sub(params.cellRadius);
  const wear = noise3(vec3(local.mul(4.7), randomValue.mul(13)))
    .sub(0.5)
    .mul(params.grassEdgeWear)
    .mul(0.16);
  return float(1).sub(smoothstep(-0.018, 0.028, distance.add(wear)));
}

function grassBlade2d(
  coordinate: Node<'vec2'>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const clumpNoise = valueNoise2(coordinate.mul(params.grassClumpScale).mul(0.46), seed.add(31));
  const clumpMask = mix(1, smoothstep(0.24, 0.78, clumpNoise), params.grassClumpStrength);
  const q = coordinate.mul(params.density);
  const cell = floor(q);
  let local = fract(q).sub(0.5);
  const randomA = hash21(cell, seed);
  const randomB = hash21(cell.add(17), seed.add(9));
  const randomC = hash21(cell.add(37), seed.add(21));
  const randomD = hash21(cell.add(71), seed.add(43));

  local = local.sub(vec2(randomA, randomB).sub(0.5).mul(params.grassJitterOffset));
  const directionNoise = valueNoise2(
    cell.div(max(params.density, 0.1)).mul(max(params.grassClumpScale, 0.1)).mul(0.58),
    seed.add(67)
  );
  const coherentAngle = directionNoise.sub(0.5).mul(Math.PI * 2);
  const randomAngle = randomA.sub(0.5).mul(Math.PI * 2).mul(params.grassLeanJitter);
  local = rotate(local, mix(randomAngle, coherentAngle, params.grassDirectionality));

  const lengthScale = mix(
    float(1).sub(params.grassHeightJitter),
    float(1).add(params.grassHeightJitter),
    randomB
  );
  const lengthValue = clamp(params.grassBladeLength.mul(lengthScale), 0.2, 0.98);
  const along = local.y.add(0.5);
  const t = clamp(along.div(max(lengthValue, 0.001)), 0, 1);
  const bendSign = mix(-1, 1, step(0.5, randomC));
  const centerline = bendSign.mul(params.grassBladeBend).mul(pow(t, params.grassBladeCurvature))
    .add(randomD.sub(0.5).mul(params.grassLeanJitter).mul(0.08).mul(t));

  const widthScale = mix(
    float(1).sub(params.grassWidthJitter),
    float(1).add(params.grassWidthJitter),
    randomC
  );
  const taper = max(pow(max(float(1).sub(t), 0), params.grassBladeTaper), 0.035);
  const widthAtHeight = params.grassBladeWidth.mul(widthScale).mul(taper);
  const edgeNoise = noise3(vec3(local.mul(8), seed.add(randomD.mul(11))))
    .sub(0.5)
    .mul(params.grassEdgeWear)
    .mul(params.grassBladeWidth)
    .mul(0.55);
  const bladeEdge = abs(local.x.sub(centerline)).add(edgeNoise);
  const feather = max(0.004, params.grassBladeWidth.mul(0.22));
  const blade = float(1).sub(smoothstep(widthAtHeight, widthAtHeight.add(feather), bladeEdge));

  const rootMask = smoothstep(0, 0.035, along);
  const tipMask = float(1).sub(smoothstep(max(lengthValue.sub(0.05), 0), lengthValue, along));
  const presence = step(params.grassDryness.mul(0.72), randomD);
  const rootTone = mix(float(1).sub(params.grassRootDarkening.mul(0.55)), 1, t);
  const tipTone = float(1).sub(
    params.grassTipFade.mul(smoothstep(0.72, 1, t)).mul(0.3)
  );
  const tone = rootTone.mul(tipTone).mul(mix(0.82, 1, randomB));

  return clamp(blade.mul(rootMask).mul(tipMask).mul(clumpMask).mul(presence).mul(tone), 0, 1);
}

function turfFiber2d(
  coordinate: Node<'vec2'>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  const density = max(params.density, 0.1).mul(2.2);
  const tuftNoise = valueNoise2(coordinate.mul(params.grassClumpScale).mul(0.55), seed.add(103));
  const tuftShape = smoothstep(0.16, 0.84, tuftNoise);
  const tuftMask = mix(0.76, tuftShape, params.grassClumpStrength.mul(0.72));
  const q = coordinate.mul(density);
  const cell = floor(q);
  let local = fract(q).sub(0.5);
  const randomA = hash21(cell, seed.add(7));
  const randomB = hash21(cell.add(19), seed.add(17));
  const randomC = hash21(cell.add(43), seed.add(29));
  const randomD = hash21(cell.add(73), seed.add(47));

  local = local.sub(vec2(randomA, randomB).sub(0.5).mul(params.grassJitterOffset).mul(1.3));
  const directionNoise = valueNoise2(
    cell.div(max(density, 0.1)).mul(max(params.grassClumpScale, 0.1)).mul(0.72),
    seed.add(79)
  );
  const coherentAngle = directionNoise.sub(0.5).mul(Math.PI * 2);
  const randomAngle = randomA.sub(0.5).mul(Math.PI * 2);
  local = rotate(local, mix(randomAngle, coherentAngle, params.grassDirectionality));

  const lengthValue = params.turfFiberLength.mul(mix(0.72, 1.28, randomB));
  const halfLength = lengthValue.mul(0.5);
  const widthValue = params.turfFiberWidth.mul(mix(0.72, 1.28, randomC));
  const feather = mix(0.0025, max(0.006, widthValue.mul(0.72)), params.turfFiberSoftness);
  const lateral = float(1).sub(smoothstep(widthValue, widthValue.add(feather), abs(local.x)));
  const axial = float(1).sub(
    smoothstep(halfLength, halfLength.add(feather.mul(2)), abs(local.y))
  );
  const fragmentNoise = valueNoise2(
    vec2(local.y.mul(13).add(randomD.mul(3)), local.x.mul(4).add(randomA.mul(5))),
    seed.add(131)
  );
  const breakup = clamp(params.turfFiberBreakup.add(params.grassDryness.mul(0.22)), 0, 1);
  const fragmentMask = mix(1, smoothstep(0.22, 0.76, fragmentNoise), breakup);
  const fiber = lateral.mul(axial).mul(fragmentMask);

  const carpetNoise = valueNoise2(coordinate.mul(density).mul(0.62), seed.add(151));
  const carpet = smoothstep(0.28, 0.76, carpetNoise.mul(0.64).add(tuftNoise.mul(0.36)));
  const fiberPresence = mix(1, step(params.grassDryness.mul(0.55), randomD), 0.32);
  const fiberMass = max(carpet.mul(0.76), fiber.mul(fiberPresence));
  const mass = mix(carpet.mul(0.82), fiberMass, 0.42);
  const rootTone = mix(float(1).sub(params.grassRootDarkening.mul(0.24)), 1, tuftNoise);
  const wearTone = float(1).sub(params.grassEdgeWear.mul(float(1).sub(fragmentMask)).mul(0.22));

  return clamp(
    mass.mul(tuftMask).mul(rootTone).mul(wearTone).mul(mix(0.9, 1, randomB)),
    0,
    1
  );
}

function pattern2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  let domain = rotate(coordinate, params.rotationRadians);

  if (settings.kind === 'grass') return grassBlade2d(domain, params, seed);
  if (settings.kind === 'turf') return turfFiber2d(domain, params, seed);

  if (settings.kind === 'pebble') {
    domain = domain.mul(params.density);
    const cell = floor(domain);
    let local = fract(domain).sub(0.5);
    const randomA = hash21(cell, seed);
    const randomB = hash21(cell.add(23), seed.add(3));
    local = local.sub(vec2(randomA, randomB).sub(0.5).mul(params.pebbleJitterOffset));
    local = rotate(local, randomB.sub(0.5).mul(params.pebbleJitterRotate));
    const radius = mix(0.28, 0.46, randomA).mul(params.pebbleRadiusScale);
    const normalized = vec2(local.x.div(params.pebbleXScale), local.y);
    const distance = normalized.length().sub(radius)
      .add(randomA.sub(0.5).mul(params.pebbleWear));
    const mask = float(1).sub(smoothstep(-0.02, 0.035, distance));
    const dome = clamp(float(1).sub(normalized.length().div(max(radius, 0.001))), 0, 1);
    return mask.mul(mix(0.55, 1, dome.sqrt()));
  }

  if (settings.kind === 'fabric') {
    domain = domain.mul(params.density);
    const warp = float(1).sub(smoothstep(params.fabricWidth, params.fabricWidthUpper, abs(fract(domain.x).sub(0.5))));
    const weft = float(1).sub(smoothstep(params.fabricWidth, params.fabricWidthUpper, abs(fract(domain.y).sub(0.5))));
    const parity = fract(floor(domain.x).add(floor(domain.y)).mul(0.5)).mul(2);
    return clamp(mix(max(warp.mul(0.78), weft), max(warp, weft.mul(0.78)), parity), 0, 1);
  }

  domain = vec2(domain.x.div(params.aspectDivisor), domain.y);
  const row = floor(domain.y);
  if (settings.kind === 'brick' || settings.kind === 'plank' || settings.kind === 'roof-tile') {
    domain = vec2(domain.x.add(fract(row.mul(0.5)).mul(2).mul(params.offset)), domain.y);
  }
  const cell = floor(domain);
  let local = fract(domain).sub(0.5);
  const randomA = hash21(cell, seed);
  const randomB = hash21(cell.add(31), seed.add(5));
  local = local.sub(vec2(randomA, randomB).sub(0.5).mul(params.cellJitterOffset));
  const mask = roundedCell(local, params, randomA);

  if (settings.kind === 'roof-tile') {
    const barrel = local.x.mul(Math.PI).cos().mul(0.42).add(0.58);
    const overlap = smoothstep(-0.5, -0.18, local.y);
    return clamp(mask.mul(mix(barrel.mul(0.72), barrel, overlap)), 0, 1);
  }
  if (settings.kind === 'plank') {
    return clamp(mask.mul(float(1).sub(abs(local.y).mul(0.2))).mul(mix(0.88, 1, randomB)), 0, 1);
  }
  if (settings.kind === 'brick') {
    return clamp(mask.mul(float(1).sub(local.length().mul(0.12))).mul(mix(0.92, 1, randomB)), 0, 1);
  }
  return clamp(mask.mul(mix(0.92, 1, randomB)), 0, 1);
}

export function buildWebGpuPatternField(
  position: Node<'vec3'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>,
  triplanarNormal: Node<'vec3'>
): Node<'float'> {
  const xy = pattern2d(position.xy, settings, params, seed);
  const xz = pattern2d(position.xz, settings, params, seed.add(11));
  const yz = pattern2d(position.yz, settings, params, seed.add(23));
  if (settings.kind === 'grass' || settings.kind === 'turf') {
    const peak = max(xy, max(xz, yz));
    const average = xy.add(xz).add(yz).div(3);
    const averageMix = settings.kind === 'grass'
      ? grassPatternConfig.rendering.triplanarAverageMix
      : grassPatternConfig.rendering.turfTriplanarAverageMix;
    return clamp(mix(peak, average, averageMix), 0, 1);
  }
  const weights = pow(abs(triplanarNormal.normalize()), structuredPatternConfig.projection.sharpness);
  const total = max(weights.x.add(weights.y).add(weights.z), 0.0001);
  return clamp(yz.mul(weights.x).add(xz.mul(weights.y)).add(xy.mul(weights.z)).div(total), 0, 1);
}
