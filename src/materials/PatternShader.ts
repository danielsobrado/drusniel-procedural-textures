import {
  RUNTIME_GRASS_PATTERN_CONFIG as grassPatternConfig,
  RUNTIME_STRUCTURED_PATTERN_CONFIG as structuredPatternConfig
} from '../core/material/generated/runtimeConfig';
import type { PatternKind } from '../core/material/PatternSettings';

const STRUCTURED_TRIPLANAR_SHARPNESS = structuredPatternConfig.projection.sharpness.toFixed(6);
const GRASS_DISPLACEMENT_GAIN = grassPatternConfig.rendering.geometryDisplacementGain.toFixed(6);
const GRASS_TRIPLANAR_AVERAGE_MIX = grassPatternConfig.rendering.triplanarAverageMix.toFixed(6);
const TURF_DISPLACEMENT_GAIN = grassPatternConfig.rendering.turfGeometryDisplacementGain.toFixed(6);
const TURF_TRIPLANAR_AVERAGE_MIX = grassPatternConfig.rendering.turfTriplanarAverageMix.toFixed(6);
const TURF_FIBER_LENGTH_MIN = grassPatternConfig.turfLimits.fiberLength.min.toFixed(6);
const TURF_FIBER_LENGTH_MAX = grassPatternConfig.turfLimits.fiberLength.max.toFixed(6);
const TURF_FIBER_WIDTH_MIN = grassPatternConfig.turfLimits.fiberWidth.min.toFixed(6);
const TURF_FIBER_WIDTH_MAX = grassPatternConfig.turfLimits.fiberWidth.max.toFixed(6);

export const PATTERN_KIND_CODE: Record<PatternKind, number> = {
  brick: 0,
  tile: 1,
  plank: 2,
  grass: 3,
  pebble: 4,
  'roof-tile': 5,
  fabric: 6,
  turf: 7
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
uniform float uLabPatternEdgeWear[LAB_MAX_LAYERS];
uniform float uLabGrassBladeLength[LAB_MAX_LAYERS];
uniform float uLabGrassBladeWidth[LAB_MAX_LAYERS];
uniform float uLabGrassBladeTaper[LAB_MAX_LAYERS];
uniform float uLabGrassBladeBend[LAB_MAX_LAYERS];
uniform float uLabGrassBladeCurvature[LAB_MAX_LAYERS];
uniform float uLabGrassClumpScale[LAB_MAX_LAYERS];
uniform float uLabGrassClumpStrength[LAB_MAX_LAYERS];
uniform float uLabGrassDirectionality[LAB_MAX_LAYERS];
uniform float uLabGrassDryness[LAB_MAX_LAYERS];
uniform float uLabGrassTipFade[LAB_MAX_LAYERS];
uniform float uLabGrassRootDarkening[LAB_MAX_LAYERS];
uniform float uLabGrassHeightJitter[LAB_MAX_LAYERS];
uniform float uLabGrassWidthJitter[LAB_MAX_LAYERS];
uniform float uLabGrassLeanJitter[LAB_MAX_LAYERS];
uniform float uLabTurfFiberLength[LAB_MAX_LAYERS];
uniform float uLabTurfFiberWidth[LAB_MAX_LAYERS];
uniform float uLabTurfFiberBreakup[LAB_MAX_LAYERS];
uniform float uLabTurfFiberSoftness[LAB_MAX_LAYERS];`;

export const PATTERN_GLSL_HELPERS = `
mat2 labPatternRotation(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float labPatternHash(vec2 cell, float seed) {
  return labHash31(vec3(cell, seed * 0.173));
}

float labPatternValueNoise(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 smoothLocal = local * local * (3.0 - 2.0 * local);
  float a = labPatternHash(cell, seed);
  float b = labPatternHash(cell + vec2(1.0, 0.0), seed);
  float c = labPatternHash(cell + vec2(0.0, 1.0), seed);
  float d = labPatternHash(cell + vec2(1.0, 1.0), seed);
  return mix(mix(a, b, smoothLocal.x), mix(c, d, smoothLocal.x), smoothLocal.y);
}

float labPatternDisplacementGain(int layerIndex) {
  int kind = uLabPatternKind[layerIndex];
  if (kind == 3) return ${GRASS_DISPLACEMENT_GAIN};
  if (kind == 7) return ${TURF_DISPLACEMENT_GAIN};
  return 1.0;
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

float labGrassBlade2d(int layerIndex, vec2 coordinate, float seed) {
  float density = max(uLabPatternDensity[layerIndex], 0.1);
  float jitter = clamp(uLabPatternJitter[layerIndex], 0.0, 1.0);
  float edgeWear = clamp(uLabPatternEdgeWear[layerIndex], 0.0, 1.0);
  float bladeLength = clamp(uLabGrassBladeLength[layerIndex], 0.35, 0.95);
  float bladeWidth = clamp(uLabGrassBladeWidth[layerIndex], 0.012, 0.14);
  float bladeTaper = clamp(uLabGrassBladeTaper[layerIndex], 0.4, 3.0);
  float bladeBend = clamp(uLabGrassBladeBend[layerIndex], 0.0, 0.35);
  float bladeCurvature = clamp(uLabGrassBladeCurvature[layerIndex], 0.5, 3.0);
  float clumpScale = clamp(uLabGrassClumpScale[layerIndex], 0.1, 3.0);
  float clumpStrength = clamp(uLabGrassClumpStrength[layerIndex], 0.0, 1.0);
  float directionality = clamp(uLabGrassDirectionality[layerIndex], 0.0, 1.0);
  float dryness = clamp(uLabGrassDryness[layerIndex], 0.0, 1.0);
  float tipFade = clamp(uLabGrassTipFade[layerIndex], 0.0, 1.0);
  float rootDarkening = clamp(uLabGrassRootDarkening[layerIndex], 0.0, 1.0);
  float heightJitter = clamp(uLabGrassHeightJitter[layerIndex], 0.0, 0.65);
  float widthJitter = clamp(uLabGrassWidthJitter[layerIndex], 0.0, 0.65);
  float leanJitter = clamp(uLabGrassLeanJitter[layerIndex], 0.0, 1.0);

  float clumpNoise = labPatternValueNoise(coordinate * clumpScale * 0.46, seed + 31.0);
  float clumpMask = mix(1.0, smoothstep(0.24, 0.78, clumpNoise), clumpStrength);

  vec2 q = coordinate * density;
  vec2 cell = floor(q);
  vec2 local = fract(q) - 0.5;
  float randomA = labPatternHash(cell, seed);
  float randomB = labPatternHash(cell + 17.0, seed + 9.0);
  float randomC = labPatternHash(cell + 37.0, seed + 21.0);
  float randomD = labPatternHash(cell + 71.0, seed + 43.0);

  local -= (vec2(randomA, randomB) - 0.5) * jitter * 0.26;
  float directionNoise = labPatternValueNoise(
    cell / max(density, 0.1) * max(clumpScale, 0.1) * 0.58,
    seed + 67.0
  );
  float coherentAngle = (directionNoise - 0.5) * 6.2831853;
  float randomAngle = (randomA - 0.5) * 6.2831853 * leanJitter;
  local = labPatternRotation(mix(randomAngle, coherentAngle, directionality)) * local;

  float lengthScale = mix(1.0 - heightJitter, 1.0 + heightJitter, randomB);
  float lengthValue = clamp(bladeLength * lengthScale, 0.2, 0.98);
  float along = local.y + 0.5;
  float t = clamp(along / max(lengthValue, 0.001), 0.0, 1.0);
  float bendSign = randomC < 0.5 ? -1.0 : 1.0;
  float centerline = bendSign * bladeBend * pow(t, bladeCurvature);
  centerline += (randomD - 0.5) * leanJitter * 0.08 * t;

  float widthScale = mix(1.0 - widthJitter, 1.0 + widthJitter, randomC);
  float taper = max(pow(max(1.0 - t, 0.0), bladeTaper), 0.035);
  float widthAtHeight = bladeWidth * widthScale * taper;
  float edgeNoise = (labNoise3(vec3(local * 8.0, seed + randomD * 11.0)) - 0.5)
    * edgeWear * bladeWidth * 0.55;
  float bladeEdge = abs(local.x - centerline) + edgeNoise;
  float feather = max(0.004, bladeWidth * 0.22);
  float blade = 1.0 - smoothstep(widthAtHeight, widthAtHeight + feather, bladeEdge);

  float rootMask = smoothstep(0.0, 0.035, along);
  float tipMask = 1.0 - smoothstep(max(lengthValue - 0.05, 0.0), lengthValue, along);
  float presence = step(dryness * 0.72, randomD);
  float rootTone = mix(1.0 - rootDarkening * 0.55, 1.0, t);
  float tipTone = 1.0 - tipFade * smoothstep(0.72, 1.0, t) * 0.3;
  float bladeTone = rootTone * tipTone * mix(0.82, 1.0, randomB);

  return clamp(blade * rootMask * tipMask * clumpMask * presence * bladeTone, 0.0, 1.0);
}

float labTurfFiber2d(int layerIndex, vec2 coordinate, float seed) {
  float density = max(uLabPatternDensity[layerIndex], 0.1) * 2.2;
  float jitter = clamp(uLabPatternJitter[layerIndex], 0.0, 1.0);
  float edgeWear = clamp(uLabPatternEdgeWear[layerIndex], 0.0, 1.0);
  float clumpScale = clamp(uLabGrassClumpScale[layerIndex], 0.1, 3.0);
  float clumpStrength = clamp(uLabGrassClumpStrength[layerIndex], 0.0, 1.0);
  float directionality = clamp(uLabGrassDirectionality[layerIndex], 0.0, 1.0);
  float dryness = clamp(uLabGrassDryness[layerIndex], 0.0, 1.0);
  float rootDarkening = clamp(uLabGrassRootDarkening[layerIndex], 0.0, 1.0);
  float fiberLength = clamp(uLabTurfFiberLength[layerIndex], ${TURF_FIBER_LENGTH_MIN}, ${TURF_FIBER_LENGTH_MAX});
  float fiberWidth = clamp(uLabTurfFiberWidth[layerIndex], ${TURF_FIBER_WIDTH_MIN}, ${TURF_FIBER_WIDTH_MAX});
  float breakup = clamp(uLabTurfFiberBreakup[layerIndex] + dryness * 0.22, 0.0, 1.0);
  float softness = clamp(uLabTurfFiberSoftness[layerIndex], 0.0, 1.0);

  float tuftNoise = labPatternValueNoise(coordinate * clumpScale * 0.55, seed + 103.0);
  float tuftShape = smoothstep(0.16, 0.84, tuftNoise);
  float tuftMask = mix(0.76, tuftShape, clumpStrength * 0.72);

  vec2 q = coordinate * density;
  vec2 cell = floor(q);
  vec2 local = fract(q) - 0.5;
  float randomA = labPatternHash(cell, seed + 7.0);
  float randomB = labPatternHash(cell + 19.0, seed + 17.0);
  float randomC = labPatternHash(cell + 43.0, seed + 29.0);
  float randomD = labPatternHash(cell + 73.0, seed + 47.0);

  local -= (vec2(randomA, randomB) - 0.5) * jitter * 0.34;
  float directionNoise = labPatternValueNoise(
    cell / max(density, 0.1) * max(clumpScale, 0.1) * 0.72,
    seed + 79.0
  );
  float coherentAngle = (directionNoise - 0.5) * 6.2831853;
  float randomAngle = (randomA - 0.5) * 6.2831853;
  local = labPatternRotation(mix(randomAngle, coherentAngle, directionality)) * local;

  float lengthValue = fiberLength * mix(0.72, 1.28, randomB);
  float halfLength = lengthValue * 0.5;
  float widthValue = fiberWidth * mix(0.72, 1.28, randomC);
  float feather = mix(0.0025, max(0.006, widthValue * 0.72), softness);
  float lateral = 1.0 - smoothstep(widthValue, widthValue + feather, abs(local.x));
  float axial = 1.0 - smoothstep(halfLength, halfLength + feather * 2.0, abs(local.y));
  float fragmentNoise = labPatternValueNoise(
    vec2(local.y * 13.0 + randomD * 3.0, local.x * 4.0 + randomA * 5.0),
    seed + 131.0
  );
  float fragmentMask = mix(1.0, smoothstep(0.22, 0.76, fragmentNoise), breakup);
  float fiber = lateral * axial * fragmentMask;

  float carpetNoise = labPatternValueNoise(coordinate * density * 0.62, seed + 151.0);
  float carpet = smoothstep(0.28, 0.76, carpetNoise * 0.64 + tuftNoise * 0.36);
  float fiberPresence = mix(1.0, step(dryness * 0.55, randomD), 0.32);
  float mass = max(carpet * 0.76, fiber * fiberPresence);
  mass = mix(carpet * 0.82, mass, 0.42);

  float rootTone = mix(1.0 - rootDarkening * 0.24, 1.0, tuftNoise);
  float wearTone = 1.0 - edgeWear * (1.0 - fragmentMask) * 0.22;
  return clamp(mass * tuftMask * rootTone * wearTone * mix(0.9, 1.0, randomB), 0.0, 1.0);
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

  if (kind == 3) return labGrassBlade2d(layerIndex, q, seed);
  if (kind == 7) return labTurfFiber2d(layerIndex, q, seed);

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
  int kind = uLabPatternKind[layerIndex];
  if (kind == 3 || kind == 7) {
    float peak = max(xy, max(xz, yz));
    float average = (xy + xz + yz) / 3.0;
    float averageMix = kind == 3 ? ${GRASS_TRIPLANAR_AVERAGE_MIX} : ${TURF_TRIPLANAR_AVERAGE_MIX};
    return clamp(mix(peak, average, averageMix), 0.0, 1.0);
  }
  // Structured patterns are weighted by the surface normal, so a face pointing down an axis
  // reads its own projection. A plain max of the three would show whichever projection happens
  // to be brightest regardless of orientation, and the locus where two of them cross reads as
  // a hard seam — a ring around a sphere. This matches buildWebGpuStructuredPatternField.
  vec3 weights = pow(abs(labTriplanarNormal), vec3(${STRUCTURED_TRIPLANAR_SHARPNESS}));
  float totalWeight = max(weights.x + weights.y + weights.z, 0.0001);
  return clamp((yz * weights.x + xz * weights.y + xy * weights.z) / totalWeight, 0.0, 1.0);
}
`;
