import type { Node } from 'three/webgpu';
import { abs, clamp, float, floor, fract, max, mix, smoothstep, vec2 } from 'three/tsl';
import type { PatternSettings } from '../core/material/PatternSettings';

/**
 * Pattern parameters as uniform nodes.
 *
 * These used to be baked into the graph as literals, which put every one of them in the
 * shader's topology fingerprint: nudging `gap` or `jitter` rebuilt the whole TSL tree and
 * forced a shader recompile. Only `kind` is structural - it selects genuinely different
 * geometry - so it stays a literal and everything else became a uniform.
 *
 * These are *derived* values, not the raw settings: everything the old code folded on
 * the CPU stays folded on the CPU, so the shader does a handful fewer multiplies per
 * pixel and per pattern axis.
 *
 * Be aware this does NOT reproduce the previous image bit-for-bit, and it cannot. A GPU
 * compiler optimises `x * 3.1` (a literal) differently from `x * u_density`, and
 * `hash21` runs its input through `sin(x * 43758.5453)`, which turns a 1-ULP difference
 * into a different cell hash. The measured effect on the live preview is a mean channel
 * delta below 1/255, concentrated at cell boundaries. Baked and exported textures are
 * unaffected - they come from the separate GLSL path in MaterialCompiler.
 */
export interface PatternParamNodes {
  rotationRadians: Node<'float'>;
  density: Node<'float'>;
  grassJitterOffset: Node<'float'>;
  grassJitterRotate: Node<'float'>;
  grassRotationBias: Node<'float'>;
  grassWidth: Node<'float'>;
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

/** The CPU-side folding, kept next to the shader code that consumes it. */
export function derivePatternParams(settings: Readonly<PatternSettings>): PatternParamValues {
  const inset = Math.min(settings.gap * 0.5, 0.225);
  const half = 0.5 - inset;
  const radius = Math.min(settings.roundness, 0.5) * half;
  const fabricWidth = Math.max(0.08, Math.min(0.48, 0.5 - settings.gap * 0.7));
  const aspectAtLeastOne = Math.max(settings.aspect, 1);

  return {
    rotationRadians: settings.rotation * Math.PI,
    density: settings.density,
    grassJitterOffset: settings.jitter * 0.42,
    grassJitterRotate: settings.jitter * 1.3,
    grassRotationBias: settings.rotation * 1.2,
    grassWidth: 0.045 + (0.13 - 0.045) * Math.min(Math.max(settings.aspect, 0), 1),
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
  return fract(
    position.dot(vec2(127.1, 311.7)).add(seed.mul(74.7)).sin().mul(43758.5453123)
  );
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
  randomValue: Node<'float'>
): Node<'float'> {
  const q = max(abs(local).sub(params.cellInnerHalf), vec2(0));
  const wear = randomValue.sub(0.5).mul(params.cellWear);
  return float(1).sub(smoothstep(-0.012, 0.035, q.length().sub(params.cellRadius).add(wear)));
}

function pattern2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  params: PatternParamNodes,
  seed: Node<'float'>
): Node<'float'> {
  let domain = rotate(coordinate, params.rotationRadians);

  if (settings.kind === 'grass') {
    domain = domain.mul(params.density);
    const cell = floor(domain);
    let local = fract(domain).sub(0.5);
    const randomA = hash21(cell, seed);
    const randomB = hash21(cell.add(17), seed.add(9));
    local = local.sub(vec2(randomA, randomB).sub(0.5).mul(params.grassJitterOffset));
    local = rotate(local, randomA.sub(0.5).mul(params.grassJitterRotate).add(params.grassRotationBias));
    const width = params.grassWidth;
    const taper = mix(0.35, 1, clamp(local.y.add(0.5), 0, 1));
    const blade = float(1).sub(smoothstep(width.mul(taper), width.mul(taper).add(0.025), abs(local.x)));
    const lengthMask = float(1).sub(smoothstep(0.36, 0.5, abs(local.y)));
    return clamp(blade.mul(lengthMask).mul(mix(0.78, 1, randomB)), 0, 1);
  }

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
  seed: Node<'float'>
): Node<'float'> {
  const xy = pattern2d(position.xy, settings, params, seed);
  const xz = pattern2d(position.xz, settings, params, seed.add(11));
  const yz = pattern2d(position.yz, settings, params, seed.add(23));
  return max(xy, max(xz, yz));
}
