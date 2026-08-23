import type { PatternKind } from '../core/material/PatternSettings';

export const PATTERN_KIND_CODE: Record<PatternKind, number> = {
  brick: 0,
  tile: 1,
  plank: 2,
  grass: 3,
  pebble: 4,
  'roof-tile': 5,
  fabric: 6
};

export const PATTERN_GLSL_UNIFORMS = `
uniform int uLabPatternKind[LAB_MAX_LAYERS];
uniform float uLabPatternAspect[LAB_MAX_LAYERS];
uniform float uLabPatternGap[LAB_MAX_LAYERS];
uniform float uLabPatternRoundness[LAB_MAX_LAYERS];
uniform float uLabPatternJitter[LAB_MAX_LAYERS];
uniform float uLabPatternRotation[LAB_MAX_LAYERS];
uniform float uLabPatternOffset[LAB_MAX_LAYERS];
uniform float uLabPatternDensity[LAB_MAX_LAYERS];
uniform float uLabPatternEdgeWear[LAB_MAX_LAYERS];`;

export const PATTERN_GLSL_HELPERS = `
mat2 labPatternRotation(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float labPatternHash(vec2 cell, float seed) {
  return labHash31(vec3(cell, seed * 0.173));
}

float labRoundedBox2d(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - max(halfSize - radius, vec2(0.001));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float labPatternShape(vec2 local, float gap, float roundness, float edgeWear, float randomValue) {
  float inset = clamp(gap * 0.5, 0.0, 0.225);
  vec2 halfSize = vec2(0.5 - inset);
  float radius = clamp(roundness, 0.0, 0.5) * min(halfSize.x, halfSize.y);
  float wearNoise = (labNoise3(vec3(local * 4.7, randomValue * 13.0)) - 0.5) * edgeWear * 0.16;
  float distance = labRoundedBox2d(local, halfSize, radius) + wearNoise;
  return 1.0 - smoothstep(-0.018, 0.028, distance);
}

float labPattern2d(int layerIndex, vec2 coordinate, float seed) {
  int kind = uLabPatternKind[layerIndex];
  float aspect = max(uLabPatternAspect[layerIndex], 0.05);
  float gap = clamp(uLabPatternGap[layerIndex], 0.0, 0.45);
  float roundness = clamp(uLabPatternRoundness[layerIndex], 0.0, 0.5);
  float jitter = clamp(uLabPatternJitter[layerIndex], 0.0, 1.0);
  float offset = clamp(uLabPatternOffset[layerIndex], 0.0, 1.0);
  float density = max(uLabPatternDensity[layerIndex], 0.1);
  float edgeWear = clamp(uLabPatternEdgeWear[layerIndex], 0.0, 1.0);
  vec2 q = labPatternRotation(uLabPatternRotation[layerIndex] * 3.14159265) * coordinate;

  if (kind == 3) {
    q *= density;
    vec2 cell = floor(q);
    vec2 local = fract(q) - 0.5;
    float randomA = labPatternHash(cell, seed);
    float randomB = labPatternHash(cell + 17.0, seed + 9.0);
    local -= (vec2(randomA, randomB) - 0.5) * jitter * 0.42;
    float angle = (randomA - 0.5) * jitter * 1.3 + uLabPatternRotation[layerIndex] * 1.2;
    local = labPatternRotation(angle) * local;
    float bladeWidth = mix(0.045, 0.13, clamp(aspect, 0.0, 1.0));
    float taper = mix(0.35, 1.0, clamp((local.y + 0.5), 0.0, 1.0));
    float blade = 1.0 - smoothstep(bladeWidth * taper, bladeWidth * taper + 0.025, abs(local.x));
    float lengthMask = 1.0 - smoothstep(0.36, 0.5, abs(local.y));
    return clamp(blade * lengthMask * mix(0.78, 1.0, randomB), 0.0, 1.0);
  }

  if (kind == 4) {
    q *= density;
    vec2 cell = floor(q);
    vec2 local = fract(q) - 0.5;
    float randomA = labPatternHash(cell, seed);
    float randomB = labPatternHash(cell + 23.0, seed + 3.0);
    local -= (vec2(randomA, randomB) - 0.5) * jitter * 0.38;
    float angle = (randomB - 0.5) * 3.14159265 * jitter;
    local = labPatternRotation(angle) * local;
    float radius = mix(0.28, 0.46, randomA) * (1.0 - gap * 0.55);
    vec2 pebbleScale = vec2(mix(0.72, 1.0, 1.0 / max(aspect, 1.0)), 1.0);
    float distance = length(local / pebbleScale) - radius;
    float edge = (labNoise3(vec3(local * 6.0, seed + randomB * 7.0)) - 0.5) * edgeWear * 0.08;
    float mask = 1.0 - smoothstep(-0.02, 0.035, distance + edge);
    float dome = clamp(1.0 - length(local / pebbleScale) / max(radius, 0.001), 0.0, 1.0);
    return mask * mix(0.55, 1.0, sqrt(dome));
  }

  if (kind == 6) {
    q *= density;
    float width = clamp(0.5 - gap * 0.7, 0.08, 0.48);
    float warp = 1.0 - smoothstep(width, width + 0.035, abs(fract(q.x) - 0.5));
    float weft = 1.0 - smoothstep(width, width + 0.035, abs(fract(q.y) - 0.5));
    float cellParity = mod(floor(q.x) + floor(q.y), 2.0);
    float crossing = mix(max(warp * 0.78, weft), max(warp, weft * 0.78), cellParity);
    return clamp(crossing, 0.0, 1.0);
  }

  q.x /= aspect;
  float row = floor(q.y);
  if (kind == 0 || kind == 2 || kind == 5) q.x += mod(row, 2.0) * offset;
  vec2 cell = floor(q);
  vec2 local = fract(q) - 0.5;
  float randomA = labPatternHash(cell, seed);
  float randomB = labPatternHash(cell + 31.0, seed + 5.0);
  local -= (vec2(randomA, randomB) - 0.5) * jitter * 0.16;

  if (kind == 5) {
    float mask = labPatternShape(local, gap, max(roundness, 0.18), edgeWear, randomA);
    float barrel = 0.58 + 0.42 * cos(local.x * 3.14159265);
    float overlap = smoothstep(-0.5, -0.18, local.y);
    return clamp(mask * mix(barrel * 0.72, barrel, overlap), 0.0, 1.0);
  }

  if (kind == 2) {
    float mask = labPatternShape(local, gap, roundness, edgeWear, randomA);
    float crown = 1.0 - abs(local.y) * 0.2;
    return clamp(mask * crown * mix(0.88, 1.0, randomB), 0.0, 1.0);
  }

  float mask = labPatternShape(local, gap, roundness, edgeWear, randomA);
  float crown = kind == 0 ? 1.0 - length(local) * 0.12 : 1.0;
  return clamp(mask * crown * mix(0.92, 1.0, randomB), 0.0, 1.0);
}

float labPatternField(int layerIndex, vec3 p, float seed) {
  float xy = labPattern2d(layerIndex, p.xy, seed);
  float xz = labPattern2d(layerIndex, p.xz, seed + 11.0);
  float yz = labPattern2d(layerIndex, p.yz, seed + 23.0);
  return max(xy, max(xz, yz));
}
`;
