import { MAX_LAYERS } from '../app/constants';
import { cellularConfig, glslFloat } from './CellularConfig';

const CELLULAR_JITTER = glslFloat(cellularConfig.sampling.jitter);
const CELLULAR_WARP_SCALE = glslFloat(cellularConfig.warp.scale);
const CELLULAR_WARP_STRENGTH = glslFloat(cellularConfig.warp.strength);
const CELLULAR_INTERIOR_LOW = glslFloat(cellularConfig.interior.low);
const CELLULAR_INTERIOR_HIGH = glslFloat(cellularConfig.interior.high);
const CELLULAR_BOUNDARY_COMPRESSION = glslFloat(cellularConfig.boundary.compression);
const CELLULAR_BREAKUP_SCALE = glslFloat(cellularConfig.breakup.scale);
const CELLULAR_BREAKUP_STRENGTH = glslFloat(cellularConfig.breakup.strength);
const CELLULAR_ASYMMETRY_SCALE = glslFloat(cellularConfig.asymmetry.scale);
const CELLULAR_ASYMMETRY_STRENGTH = glslFloat(cellularConfig.asymmetry.strength);
const CELLULAR_DISPLACEMENT_GAIN = glslFloat(cellularConfig.displacement.gain);
const CELLULAR_OUTPUT_FLOOR = glslFloat(cellularConfig.output.floor);
const CELLULAR_OUTPUT_GAIN = glslFloat(cellularConfig.output.gain);

export const SHARED_GLSL = /* glsl */ `
#define LAB_MAX_LAYERS ${MAX_LAYERS}

uniform int uLabCount;
uniform float uLabEnabled[LAB_MAX_LAYERS];
uniform int uLabLayerKind[LAB_MAX_LAYERS];
uniform int uLabChannel[LAB_MAX_LAYERS];
uniform float uLabOpacity[LAB_MAX_LAYERS];
uniform float uLabScale[LAB_MAX_LAYERS];
uniform float uLabStrength[LAB_MAX_LAYERS];
uniform float uLabSeed[LAB_MAX_LAYERS];
uniform float uLabDisplacement[LAB_MAX_LAYERS];
uniform float uLabGroupOpacity[LAB_MAX_LAYERS];
uniform int uLabMaskIndex[LAB_MAX_LAYERS];
uniform float uLabMaskInvert[LAB_MAX_LAYERS];
uniform float uLabMaskStrength[LAB_MAX_LAYERS];
uniform float uLabHasDisplacement;
uniform float uLabNormalStrength;

float labHash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 labHash33(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return fract(sin(p) * 43758.5453123);
}

float labNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = labHash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = labHash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = labHash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = labHash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = labHash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = labHash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = labHash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = labHash31(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float labFbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    value += labNoise3(p) * amplitude;
    p = p * 2.03 + vec3(7.1, 13.7, 4.9);
    amplitude *= 0.5;
  }
  return value;
}

float labFbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.57142857;
  for (int octave = 0; octave < 3; octave++) {
    value += labNoise3(p) * amplitude;
    p = p * 2.03 + vec3(7.1, 13.7, 4.9);
    amplitude *= 0.5;
  }
  return value;
}

vec2 labWorleyF1F2Fast(vec3 p) {
  vec3 cell = floor(p);
  vec3 local = fract(p);
  vec3 searchBase = mix(vec3(-1.0), vec3(0.0), step(vec3(0.5), local));
  float nearest = 10.0;
  float secondNearest = 10.0;

  for (int x = 0; x <= 1; x++) {
    for (int y = 0; y <= 1; y++) {
      for (int z = 0; z <= 1; z++) {
        vec3 offset = searchBase + vec3(float(x), float(y), float(z));
        vec3 jitter = (labHash33(cell + offset) - 0.5) * ${CELLULAR_JITTER};
        vec3 point = offset + 0.5 + jitter;
        vec3 delta = point - local;
        float distanceSquared = dot(delta, delta);
        if (distanceSquared < nearest) {
          secondNearest = nearest;
          nearest = distanceSquared;
        } else if (distanceSquared < secondNearest) {
          secondNearest = distanceSquared;
        }
      }
    }
  }

  return sqrt(vec2(nearest, secondNearest));
}

float labOrganicCellular(vec3 p) {
  float warpA = labNoise3(p * ${CELLULAR_WARP_SCALE} + vec3(3.7, 11.2, 1.9)) - 0.5;
  float warpB = labNoise3(p.zyx * (${CELLULAR_WARP_SCALE} * 1.09) + vec3(17.1, 4.3, 9.8)) - 0.5;
  vec3 warp = vec3(warpA, warpB, warpA * 0.52 - warpB * 0.38);
  vec3 q = p + warp * ${CELLULAR_WARP_STRENGTH};

  vec2 distances = labWorleyF1F2Fast(q);
  float gap = max(distances.y - distances.x, 0.0);
  float dominance = clamp(gap / max(distances.y, 0.0001), 0.0, 1.0);

  float asymmetry = labNoise3(q * ${CELLULAR_ASYMMETRY_SCALE} + vec3(23.0, 5.0, 41.0)) - 0.5;
  float broadInterior = 1.0 - smoothstep(0.24, 0.96, distances.x);
  float territory = smoothstep(${CELLULAR_INTERIOR_LOW}, ${CELLULAR_INTERIOR_HIGH}, dominance);
  float fused = mix(broadInterior, territory, 0.72);

  float boundaryWidth = max(${CELLULAR_INTERIOR_LOW} * 2.6, 0.04);
  float boundary = 1.0 - smoothstep(0.0, boundaryWidth, dominance);
  boundary = boundary * boundary * (3.0 - 2.0 * boundary);

  float breakup = labNoise3(q * ${CELLULAR_BREAKUP_SCALE} + vec3(7.0, 29.0, 15.0)) - 0.5;
  float grown = clamp(
    fused +
    asymmetry * ${CELLULAR_ASYMMETRY_STRENGTH} +
    breakup * ${CELLULAR_BREAKUP_STRENGTH} -
    boundary * ${CELLULAR_BOUNDARY_COMPRESSION},
    0.0,
    1.0
  );

  grown = grown * grown * (3.0 - 2.0 * grown);
  return clamp(${CELLULAR_OUTPUT_FLOOR} + grown * ${CELLULAR_OUTPUT_GAIN}, 0.0, 1.0);
}

float labVeinBand(float value, float width) {
  return 1.0 - smoothstep(width * 0.35, width, abs(value - 0.5));
}

float labPeriodicVeinBand(float value, float width) {
  float distanceToCenter = abs(fract(value) - 0.5);
  return 1.0 - smoothstep(width * 0.42, width, distanceToCenter);
}

float labMineralVeins(vec3 p) {
  float warpA = labFbm3(p * 0.085 + vec3(5.1, 17.3, 2.7)) - 0.5;
  float warpB = labFbm3(p.zyx * 0.11 + vec3(13.7, 3.9, 9.2)) - 0.5;
  vec3 q = p + vec3(warpA, warpB, warpA * 0.36 - warpB * 0.24) * 0.92;

  vec3 primaryNormal = normalize(vec3(0.74, 0.18, 0.65));
  vec3 primaryTangent = normalize(vec3(-0.22, 0.97, 0.02));
  float alongPrimary = dot(q, primaryTangent);
  float primaryWarp = (labFbm3(q * 0.19 + vec3(29.0, 7.0, 17.0)) - 0.5) * 0.54;
  primaryWarp += sin(alongPrimary * 0.42) * 0.07;
  float primaryWidth = mix(
    0.022,
    0.052,
    labNoise3(q * 0.14 + vec3(3.0, 31.0, 11.0))
  );
  float primaryCoordinate = dot(q, primaryNormal) * 0.19 + primaryWarp;
  float primary = labPeriodicVeinBand(primaryCoordinate, primaryWidth);
  float primaryHalo = labPeriodicVeinBand(primaryCoordinate, primaryWidth * 2.35) * 0.26;
  float continuity = smoothstep(
    0.25,
    0.62,
    labFbm3(q * 0.09 + vec3(41.0, 5.0, 23.0))
  );
  primary *= mix(0.52, 1.0, continuity);

  vec3 secondaryNormal = normalize(vec3(0.41, -0.31, 0.86));
  float secondaryCoordinate =
    dot(q, secondaryNormal) * 0.31 +
    (labNoise3(q * 0.34 + vec3(19.0, 43.0, 7.0)) - 0.5) * 0.34;
  float secondaryGate = smoothstep(
    0.46,
    0.72,
    labFbm3(q * 0.12 + vec3(7.0, 13.0, 37.0))
  );
  float secondary = labPeriodicVeinBand(secondaryCoordinate, 0.018) * secondaryGate * 0.72;

  vec3 hairlineNormal = normalize(vec3(-0.18, 0.94, 0.28));
  float hairlineCoordinate =
    dot(q, hairlineNormal) * 0.54 +
    (labNoise3(q * 0.61 + vec3(47.0, 17.0, 3.0)) - 0.5) * 0.18;
  float hairlineGate = smoothstep(
    0.58,
    0.76,
    labNoise3(q * 0.16 + vec3(11.0, 53.0, 29.0))
  );
  float hairline = labPeriodicVeinBand(hairlineCoordinate, 0.010) * hairlineGate * 0.34;

  float mineralDensity = smoothstep(
    0.20,
    0.75,
    labFbm3(q * 0.055 + vec3(2.0, 19.0, 43.0))
  );
  float network = max(primary, max(secondary, hairline));
  return clamp(max(network, primaryHalo) * mix(0.68, 1.0, mineralDensity), 0.0, 1.0);
}

float labBranchingVessels(vec3 p) {
  float warpA = labFbm3(p * 0.31 + vec3(3.1, 8.7, 1.3)) - 0.5;
  float warpB = labFbm3(p.zyx * 0.29 + vec3(11.2, 2.4, 7.8)) - 0.5;
  vec3 q = p + vec3(warpA, warpB, warpA * 0.55 - warpB * 0.35) * 1.15;

  float trunk = labVeinBand(labFbm3(q * 0.62), 0.078);
  float branchA = labVeinBand(labFbm3(q * 1.26 + 17.0), 0.055);
  float branchB = labVeinBand(labNoise3(q * 2.05 + vec3(31.0, 7.0, 19.0)), 0.046);
  float territory = smoothstep(0.30, 0.72, labFbm3(q * 0.18 + 9.0));
  return clamp(max(trunk, max(branchA * 0.78, branchB * 0.46)) * territory, 0.0, 1.0);
}

float labLayerField(int kind, vec3 position, float scale, float seed) {
  vec3 seedOffset = vec3(seed * 0.71, seed * 1.17, seed * 1.91);
  vec3 p = position * max(scale, 0.001) + seedOffset;

  if (kind == 0) return 0.5;
  if (kind == 1) return labFbm(p);
  if (kind == 2) return labOrganicCellular(p);
  if (kind == 3) {
    float ridge = 1.0 - abs(labFbm(p) * 2.0 - 1.0);
    return pow(clamp(ridge, 0.0, 1.0), 2.2);
  }
  if (kind == 4) return smoothstep(0.58, 0.78, labFbm(p));
  if (kind == 5) return labMineralVeins(p);
  if (kind == 6) return clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
  if (kind == 7) return labBranchingVessels(p);
  if (kind == 8) {
    float wet = labFbm3(p * 0.7 + vec3(4.0, 12.0, 7.0));
    return smoothstep(0.30, 0.72, wet);
  }
  float tissue = labFbm3(p * 0.55 + vec3(13.0, 3.0, 21.0));
  return smoothstep(0.18, 0.82, tissue);
}

float labShapeField(float field, float strength) {
  return clamp(0.5 + (field - 0.5) * max(strength, 0.0), 0.0, 1.0);
}

float labLayerCoverage(int kind, float shaped) {
  if (kind == 0) return 1.0;
  if (kind == 4 || kind == 5 || kind == 7) {
    return smoothstep(0.03, 0.92, shaped);
  }
  if (kind == 3) return mix(0.24, 1.0, shaped);
  return mix(0.48, 1.0, shaped);
}

float labDisplacementSignal(int kind, float shaped) {
  if (kind == 4 || kind == 5 || kind == 7) return shaped;
  return shaped - 0.5;
}

float labDisplacementGainForKind(int kind) {
  return kind == 2 ? ${CELLULAR_DISPLACEMENT_GAIN} : 1.0;
}

float labMaskForLayer(int layerIndex, vec3 position) {
  int maskIndex = uLabMaskIndex[layerIndex];
  if (maskIndex < 0 || maskIndex >= uLabCount) return 1.0;
  float field = labLayerField(
    uLabLayerKind[maskIndex],
    position,
    uLabScale[maskIndex],
    uLabSeed[maskIndex]
  );
  float shaped = labShapeField(field, uLabStrength[maskIndex]);
  if (uLabMaskInvert[layerIndex] > 0.5) shaped = 1.0 - shaped;
  return mix(1.0, shaped, clamp(uLabMaskStrength[layerIndex], 0.0, 1.0));
}

float labEffectiveOpacity(int layerIndex, vec3 position) {
  return clamp(
    uLabOpacity[layerIndex] * uLabGroupOpacity[layerIndex] * labMaskForLayer(layerIndex, position),
    0.0,
    1.0
  );
}

bool labRoutesHeight(int channel) {
  return channel == 0 || channel == 3;
}

float labEvaluateDisplacement(vec3 position) {
  float displacement = 0.0;
  for (int i = 0; i < LAB_MAX_LAYERS; i++) {
    if (i >= uLabCount) break;
    float layerDisplacement = uLabDisplacement[i];
    if (
      uLabEnabled[i] < 0.5 ||
      !labRoutesHeight(uLabChannel[i]) ||
      abs(layerDisplacement) <= 0.000001
    ) continue;

    float opacityBase = labEffectiveOpacity(i, position);
    if (opacityBase <= 0.000001) continue;
    int kind = uLabLayerKind[i];
    float field = labLayerField(kind, position, uLabScale[i], uLabSeed[i]);
    float shaped = labShapeField(field, uLabStrength[i]);
    float coverage = labLayerCoverage(kind, shaped);
    displacement +=
      labDisplacementSignal(kind, shaped) *
      layerDisplacement *
      labDisplacementGainForKind(kind) *
      opacityBase *
      coverage;
  }
  return displacement;
}
`;

export const FRAGMENT_GLSL = /* glsl */ `
uniform int uLabBlendMode[LAB_MAX_LAYERS];
uniform vec3 uLabColorA[LAB_MAX_LAYERS];
uniform vec3 uLabColorB[LAB_MAX_LAYERS];
uniform float uLabRoughness[LAB_MAX_LAYERS];

struct LabSurface {
  vec3 color;
  float roughness;
  float clearcoat;
  float clearcoatRoughness;
  float sss;
  vec3 sssColor;
  float displacement;
};

vec3 labBlend(vec3 base, vec3 layerColor, int mode, float opacity) {
  vec3 blended = layerColor;
  if (mode == 1) {
    blended = base * layerColor;
  } else if (mode == 2) {
    blended = min(base + layerColor, vec3(1.0));
  } else if (mode == 3) {
    blended = 1.0 - (1.0 - base) * (1.0 - layerColor);
  } else if (mode == 4) {
    vec3 low = 2.0 * base * layerColor;
    vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layerColor);
    blended = mix(low, high, step(vec3(0.5), base));
  }
  return mix(base, blended, clamp(opacity, 0.0, 1.0));
}

LabSurface labEvaluateSurface(vec3 position) {
  LabSurface surface;
  surface.color = vec3(0.42, 0.45, 0.50);
  surface.roughness = 0.0;
  surface.clearcoat = 0.0;
  surface.clearcoatRoughness = 0.18;
  surface.sss = 0.0;
  surface.sssColor = vec3(0.0);
  surface.displacement = 0.0;

  for (int i = 0; i < LAB_MAX_LAYERS; i++) {
    if (i >= uLabCount) break;
    if (uLabEnabled[i] < 0.5) continue;

    float opacityBase = labEffectiveOpacity(i, position);
    if (opacityBase <= 0.000001) continue;

    int kind = uLabLayerKind[i];
    int channel = uLabChannel[i];
    float field = labLayerField(kind, position, uLabScale[i], uLabSeed[i]);
    float shaped = labShapeField(field, uLabStrength[i]);
    float coverage = labLayerCoverage(kind, shaped);
    float opacity = clamp(opacityBase * coverage, 0.0, 1.0);
    vec3 layerColor = mix(uLabColorA[i], uLabColorB[i], shaped);

    if (labRoutesHeight(channel) && abs(uLabDisplacement[i]) > 0.000001) {
      surface.displacement +=
        labDisplacementSignal(kind, shaped) *
        uLabDisplacement[i] *
        labDisplacementGainForKind(kind) *
        opacityBase *
        coverage;
    }

    if (channel == 0 || channel == 1) {
      surface.color = labBlend(surface.color, layerColor, uLabBlendMode[i], opacity);
    }

    if (channel == 0 || channel == 2) {
      float roughnessWeight = kind == 0 ? 1.0 : mix(0.4, 1.0, shaped);
      surface.roughness += uLabRoughness[i] * opacity * roughnessWeight;
    }

    if (channel == 4) {
      float wetness = clamp(opacity * shaped * max(uLabStrength[i], 0.0), 0.0, 1.0);
      float coatTarget = clamp(
        0.12 + uLabRoughness[i] * 0.5 + (1.0 - shaped) * 0.18,
        0.02,
        1.0
      );
      surface.clearcoat = max(surface.clearcoat, wetness);
      surface.clearcoatRoughness = mix(surface.clearcoatRoughness, coatTarget, wetness);
    }

    if (channel == 5) {
      float scatter = clamp(opacity * mix(0.45, 1.0, shaped), 0.0, 1.0);
      surface.sssColor += layerColor * scatter;
      surface.sss += scatter;
    }
  }

  if (surface.sss > 0.0001) surface.sssColor /= surface.sss;
  surface.sss = clamp(surface.sss, 0.0, 1.0);
  return surface;
}
`;

const WORLD_MATRIX_GLSL = /* glsl */ `
mat4 labWorldMatrix = modelMatrix;
#ifdef USE_INSTANCING
  labWorldMatrix = labWorldMatrix * instanceMatrix;
#endif
#ifdef USE_BATCHING
  labWorldMatrix = labWorldMatrix * batchingMatrix;
#endif
vec3 labPosition = (labWorldMatrix * vec4(transformed, 1.0)).xyz;
float labDisplacement = labEvaluateDisplacement(labPosition);
mat3 labWorldLinear = mat3(labWorldMatrix);
vec3 labWorldA = labWorldLinear[0];
vec3 labWorldB = labWorldLinear[1];
vec3 labWorldC = labWorldLinear[2];
vec3 labCofactorX = cross(labWorldB, labWorldC);
vec3 labCofactorY = cross(labWorldC, labWorldA);
vec3 labCofactorZ = cross(labWorldA, labWorldB);
float labWorldDeterminant = dot(labWorldA, labCofactorX);
if (abs(labWorldDeterminant) > 0.00000001) {
  vec3 labWorldNormalRaw = mat3(labCofactorX, labCofactorY, labCofactorZ) * objectNormal;
  if (labWorldDeterminant < 0.0) labWorldNormalRaw = -labWorldNormalRaw;
  vec3 labWorldOffset = normalize(labWorldNormalRaw) * labDisplacement;
  vec3 labLocalOffset = vec3(
    dot(labWorldOffset, labCofactorX),
    dot(labWorldOffset, labCofactorY),
    dot(labWorldOffset, labCofactorZ)
  ) / labWorldDeterminant;
  transformed += labLocalOffset;
}
`;

export const SURFACE_VERTEX_DISPLACEMENT_GLSL = /* glsl */ `
#include <skinning_vertex>
${WORLD_MATRIX_GLSL}
vLabPosition = labPosition;
vLabSurfacePosition = (labWorldMatrix * vec4(transformed, 1.0)).xyz;
`;

export const DISPLACED_NORMAL_GLSL = /* glsl */ `
#include <normal_fragment_begin>
if (uLabHasDisplacement > 0.5 && uLabNormalStrength > 0.0001) {
  mat3 labViewRotation = mat3(viewMatrix);
  mat3 labInverseViewRotation = mat3(
    vec3(labViewRotation[0].x, labViewRotation[1].x, labViewRotation[2].x),
    vec3(labViewRotation[0].y, labViewRotation[1].y, labViewRotation[2].y),
    vec3(labViewRotation[0].z, labViewRotation[1].z, labViewRotation[2].z)
  );
  vec3 labBaseWorldNormal = normalize(labInverseViewRotation * normal);
  vec3 labSigmaX = dFdx(vLabSurfacePosition);
  vec3 labSigmaY = dFdy(vLabSurfacePosition);
  vec3 labR1 = cross(labSigmaY, labBaseWorldNormal);
  vec3 labR2 = cross(labBaseWorldNormal, labSigmaX);
  float labDeterminant = dot(labSigmaX, labR1);
  if (abs(labDeterminant) > 0.00000001) {
    vec3 labSurfaceGradient = (
      dFdx(labSurface.displacement) * labR1 +
      dFdy(labSurface.displacement) * labR2
    );
    if (labDeterminant < 0.0) labSurfaceGradient = -labSurfaceGradient;
    vec3 labWorldNormal = normalize(
      abs(labDeterminant) * labBaseWorldNormal - labSurfaceGradient * uLabNormalStrength
    );
    vec3 labViewNormal = normalize(labViewRotation * labWorldNormal);
    if (dot(labViewNormal, normal) < 0.0) labViewNormal = -labViewNormal;
    normal = labViewNormal;
  }
}
`;

export const PHYSICAL_LAYER_GLSL = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat = max(material.clearcoat, labSurface.clearcoat);
  material.clearcoatRoughness = mix(
    material.clearcoatRoughness,
    labSurface.clearcoatRoughness,
    labSurface.clearcoat
  );
#endif
`;

export const SSS_LIGHT_GLSL = /* glsl */ `
#include <lights_fragment_end>
if (labSurface.sss > 0.0001) {
  float labRim = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.0);
  float labForward = 0.06 + labRim * 0.32;
  totalEmissiveRadiance += labSurface.sssColor * labSurface.sss * labForward;
}
`;

export const SHADOW_NORMAL_GLSL = /* glsl */ `
#ifndef USE_DISPLACEMENTMAP
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinnormal_vertex>
#endif
#include <begin_vertex>
`;

export const SHADOW_VERTEX_DISPLACEMENT_GLSL = /* glsl */ `
#include <skinning_vertex>
${WORLD_MATRIX_GLSL}
`;