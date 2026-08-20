import { MAX_LAYERS } from '../app/constants';

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

float labWorley(vec3 p) {
  vec3 cell = floor(p);
  vec3 local = fract(p);
  float nearest = 10.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 offset = vec3(float(x), float(y), float(z));
        vec3 point = offset + labHash33(cell + offset);
        vec3 delta = point - local;
        nearest = min(nearest, dot(delta, delta));
      }
    }
  }
  return sqrt(nearest);
}

float labVeinBand(float value, float width) {
  return 1.0 - smoothstep(width * 0.35, width, abs(value - 0.5));
}

float labBranchingVessels(vec3 p) {
  vec3 warp = vec3(
    labFbm(p * 0.31 + vec3(3.1, 8.7, 1.3)),
    labFbm(p * 0.29 + vec3(11.2, 2.4, 7.8)),
    labFbm(p * 0.33 + vec3(5.5, 13.1, 4.2))
  ) - 0.5;
  vec3 q = p + warp * 1.35;
  float trunk = labVeinBand(labFbm(q * 0.62), 0.075);
  float branchA = labVeinBand(labFbm(q * 1.28 + 17.0), 0.052);
  float branchB = labVeinBand(labFbm(q * 2.15 + vec3(31.0, 7.0, 19.0)), 0.034);
  float territory = smoothstep(0.30, 0.72, labFbm(q * 0.18 + 9.0));
  return clamp(max(trunk, max(branchA * 0.82, branchB * 0.58)) * territory, 0.0, 1.0);
}

float labLayerField(int kind, vec3 position, float scale, float seed) {
  vec3 seedOffset = vec3(seed * 0.71, seed * 1.17, seed * 1.91);
  vec3 p = position * max(scale, 0.001) + seedOffset;

  if (kind == 0) return 0.5;
  if (kind == 1) return labFbm(p);
  if (kind == 2) return 1.0 - smoothstep(0.15, 0.72, labWorley(p));
  if (kind == 3) {
    float ridge = 1.0 - abs(labFbm(p) * 2.0 - 1.0);
    return pow(clamp(ridge, 0.0, 1.0), 2.2);
  }
  if (kind == 4) return smoothstep(0.58, 0.78, labFbm(p));
  if (kind == 5) {
    float vein = labVeinBand(labFbm(p), 0.072);
    float distribution = smoothstep(0.34, 0.72, labFbm(p * 0.31 + 18.0));
    return vein * distribution;
  }
  if (kind == 6) return clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
  if (kind == 7) return labBranchingVessels(p);
  if (kind == 8) {
    float wet = labFbm(p * 0.7 + vec3(4.0, 12.0, 7.0));
    return smoothstep(0.30, 0.72, wet);
  }
  float tissue = labFbm(p * 0.55 + vec3(13.0, 3.0, 21.0));
  return smoothstep(0.18, 0.82, tissue);
}

float labShapeField(float field, float strength) {
  return clamp(0.5 + (field - 0.5) * max(strength, 0.0), 0.0, 1.0);
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

    float opacity = labEffectiveOpacity(i, position);
    if (opacity <= 0.000001) continue;
    float field = labLayerField(uLabLayerKind[i], position, uLabScale[i], uLabSeed[i]);
    float shaped = labShapeField(field, uLabStrength[i]);
    displacement += (shaped - 0.5) * layerDisplacement * opacity;
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
    float coverage = kind == 0 ? 1.0 : mix(0.48, 1.0, shaped);
    float opacity = clamp(opacityBase * coverage, 0.0, 1.0);
    vec3 layerColor = mix(uLabColorA[i], uLabColorB[i], shaped);

    if (labRoutesHeight(channel) && abs(uLabDisplacement[i]) > 0.000001) {
      surface.displacement += (shaped - 0.5) * uLabDisplacement[i] * opacityBase;
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
  vec3 labSigmaX = dFdx(vLabPosition);
  vec3 labSigmaY = dFdy(vLabPosition);
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
