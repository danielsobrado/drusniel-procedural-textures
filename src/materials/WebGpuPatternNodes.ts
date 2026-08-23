import type { Node } from 'three/webgpu';
import { abs, clamp, float, floor, fract, max, mix, smoothstep, vec2 } from 'three/tsl';
import type { PatternSettings } from '../core/material/PatternSettings';

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
  settings: Readonly<PatternSettings>,
  randomValue: Node<'float'>
): Node<'float'> {
  const inset = Math.min(settings.gap * 0.5, 0.225);
  const half = 0.5 - inset;
  const radius = Math.min(settings.roundness, 0.5) * half;
  const q = max(abs(local).sub(half - radius), vec2(0));
  const wear = randomValue.sub(0.5).mul(settings.edgeWear * 0.05);
  return float(1).sub(smoothstep(-0.012, 0.035, q.length().sub(radius).add(wear)));
}

function pattern2d(
  coordinate: Node<'vec2'>,
  settings: Readonly<PatternSettings>,
  seed: Node<'float'>
): Node<'float'> {
  let domain = rotate(coordinate, float(settings.rotation * Math.PI));

  if (settings.kind === 'grass') {
    domain = domain.mul(settings.density);
    const cell = floor(domain);
    let local = fract(domain).sub(0.5);
    const randomA = hash21(cell, seed);
    const randomB = hash21(cell.add(17), seed.add(9));
    local = local.sub(vec2(randomA, randomB).sub(0.5).mul(settings.jitter * 0.42));
    local = rotate(local, randomA.sub(0.5).mul(settings.jitter * 1.3).add(settings.rotation * 1.2));
    const width = mix(0.045, 0.13, clamp(settings.aspect, 0, 1));
    const taper = mix(0.35, 1, clamp(local.y.add(0.5), 0, 1));
    const blade = float(1).sub(smoothstep(width.mul(taper), width.mul(taper).add(0.025), abs(local.x)));
    const lengthMask = float(1).sub(smoothstep(0.36, 0.5, abs(local.y)));
    return clamp(blade.mul(lengthMask).mul(mix(0.78, 1, randomB)), 0, 1);
  }

  if (settings.kind === 'pebble') {
    domain = domain.mul(settings.density);
    const cell = floor(domain);
    let local = fract(domain).sub(0.5);
    const randomA = hash21(cell, seed);
    const randomB = hash21(cell.add(23), seed.add(3));
    local = local.sub(vec2(randomA, randomB).sub(0.5).mul(settings.jitter * 0.38));
    local = rotate(local, randomB.sub(0.5).mul(Math.PI * settings.jitter));
    const radius = mix(0.28, 0.46, randomA).mul(1 - settings.gap * 0.55);
    const xScale = Math.max(settings.aspect, 1) === 1
      ? 1
      : 0.72 + 0.28 / Math.max(settings.aspect, 1);
    const normalized = vec2(local.x.div(xScale), local.y);
    const distance = normalized.length().sub(radius)
      .add(randomA.sub(0.5).mul(settings.edgeWear * 0.04));
    const mask = float(1).sub(smoothstep(-0.02, 0.035, distance));
    const dome = clamp(float(1).sub(normalized.length().div(max(radius, 0.001))), 0, 1);
    return mask.mul(mix(0.55, 1, dome.sqrt()));
  }

  if (settings.kind === 'fabric') {
    domain = domain.mul(settings.density);
    const width = Math.max(0.08, Math.min(0.48, 0.5 - settings.gap * 0.7));
    const warp = float(1).sub(smoothstep(width, width + 0.035, abs(fract(domain.x).sub(0.5))));
    const weft = float(1).sub(smoothstep(width, width + 0.035, abs(fract(domain.y).sub(0.5))));
    const parity = fract(floor(domain.x).add(floor(domain.y)).mul(0.5)).mul(2);
    return clamp(mix(max(warp.mul(0.78), weft), max(warp, weft.mul(0.78)), parity), 0, 1);
  }

  domain = vec2(domain.x.div(Math.max(settings.aspect, 0.05)), domain.y);
  const row = floor(domain.y);
  if (settings.kind === 'brick' || settings.kind === 'plank' || settings.kind === 'roof-tile') {
    domain = vec2(domain.x.add(fract(row.mul(0.5)).mul(2).mul(settings.offset)), domain.y);
  }
  const cell = floor(domain);
  let local = fract(domain).sub(0.5);
  const randomA = hash21(cell, seed);
  const randomB = hash21(cell.add(31), seed.add(5));
  local = local.sub(vec2(randomA, randomB).sub(0.5).mul(settings.jitter * 0.16));
  const mask = roundedCell(local, settings, randomA);

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
  seed: Node<'float'>
): Node<'float'> {
  const xy = pattern2d(position.xy, settings, seed);
  const xz = pattern2d(position.xz, settings, seed.add(11));
  const yz = pattern2d(position.yz, settings, seed.add(23));
  return max(xy, max(xz, yz));
}
