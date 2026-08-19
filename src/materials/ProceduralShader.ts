import { MAX_LAYERS } from '../app/constants';

export const SHARED_GLSL = /* glsl */ `
#define LAB_MAX_LAYERS ${MAX_LAYERS}

uniform int uLabCount;
uniform float uLabEnabled[LAB_MAX_LAYERS];
uniform int uLabLayerKind[LAB_MAX_LAYERS];
uniform float uLabOpacity[LAB_MAX_LAYERS];
uniform float uLabScale[LAB_MAX_LAYERS];
uniform float uLabStrength[LAB_MAX_LAYERS];
uniform float uLabSeed[LAB_MAX_LAYERS];
uniform float uLabDisplacement[LAB_MAX_LAYERS];

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

float labLayerField(int kind, vec3 position, float scale, float seed) {
  vec3 seedOffset = vec3(seed * 0.71, seed * 1.17, seed * 1.91);
  vec3 p = position * max(scale, 0.001) + seedOffset;

  if (kind == 0) {
    return 0.5;
  }

  if (kind == 1) {
    return labFbm(p);
  }

  if (kind == 2) {
    float cellular = labWorley(p);
    return 1.0 - smoothstep(0.15, 0.72, cellular);
  }

  if (kind == 3) {
    float ridge = 1.0 - abs(labFbm(p) * 2.0 - 1.0);
    return pow(clamp(ridge, 0.0, 1.0), 2.2);
  }

  if (kind == 4) {
    return smoothstep(0.58, 0.78, labFbm(p));
  }

  if (kind == 5) {
    float vein = 1.0 - smoothstep(0.018, 0.072, abs(labFbm(p) - 0.5));
    float distribution = smoothstep(0.34, 0.72, labFbm(p * 0.31 + 18.0));
    return vein * distribution;
  }

  return clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
}

float labShapeField(float field, float strength) {
  return clamp(0.5 + (field - 0.5) * max(strength, 0.0), 0.0, 1.0);
}

float labEvaluateDisplacement(vec3 position) {
  float displacement = 0.0;

  for (int i = 0; i < LAB_MAX_LAYERS; i++) {
    if (i >= uLabCount) {
      break;
    }

    if (uLabEnabled[i] < 0.5) {
      continue;
    }

    float field = labLayerField(
      uLabLayerKind[i],
      position,
      uLabScale[i],
      uLabSeed[i]
    );

    float shaped = labShapeField(field, uLabStrength[i]);
    displacement += (shaped - 0.5) * uLabDisplacement[i] * uLabOpacity[i];
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

  for (int i = 0; i < LAB_MAX_LAYERS; i++) {
    if (i >= uLabCount) {
      break;
    }

    if (uLabEnabled[i] < 0.5) {
      continue;
    }

    int kind = uLabLayerKind[i];
    float field = labLayerField(
      kind,
      position,
      uLabScale[i],
      uLabSeed[i]
    );

    float shaped = labShapeField(field, uLabStrength[i]);
    float coverage = kind == 0 ? 1.0 : mix(0.55, 1.0, shaped);
    float opacity = clamp(uLabOpacity[i] * coverage, 0.0, 1.0);
    float roughnessWeight = kind == 0 ? 1.0 : mix(0.45, 1.0, shaped);
    vec3 layerColor = mix(uLabColorA[i], uLabColorB[i], shaped);

    surface.color = labBlend(surface.color, layerColor, uLabBlendMode[i], opacity);
    surface.roughness += uLabRoughness[i] * opacity * roughnessWeight;
  }

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
float labNormalScale = max(length(mat3(labWorldMatrix) * objectNormal), 0.00001);
transformed += objectNormal * (labDisplacement / labNormalScale);
`;

export const SURFACE_VERTEX_DISPLACEMENT_GLSL = /* glsl */ `
#include <skinning_vertex>
${WORLD_MATRIX_GLSL}
vLabPosition = labPosition;
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