import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import {
  FRAGMENT_GLSL as COMPACT_FRAGMENT_GLSL,
  SHARED_GLSL as COMPACT_SHARED_GLSL
} from '../materials/ProceduralShader';
import {
  FRAGMENT_GLSL as PORTABLE_FRAGMENT_GLSL,
  SHARED_GLSL as PORTABLE_SHARED_GLSL
} from '../materials/PortableProceduralShader';

export type BakeShaderProfile = 'compact' | 'portable';
export type BakeShaderPass = 'surface' | 'displacement';

const LAYER_LIMIT_DIRECTIVE = /^#define LAB_MAX_LAYERS \d+$/m;

export const BAKE_VERTEX_GLSL = /* glsl */ `
uniform int uLabCoordinateSpace;

varying vec3 vBakePosition;
varying vec3 vBakeWorldPosition;
varying vec3 vBakeWorldNormal;
varying vec3 vBakeTriplanarNormal;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  mat3 labViewRotation = mat3(viewMatrix);
  mat3 labInverseViewRotation = mat3(
    vec3(labViewRotation[0].x, labViewRotation[1].x, labViewRotation[2].x),
    vec3(labViewRotation[0].y, labViewRotation[1].y, labViewRotation[2].y),
    vec3(labViewRotation[0].z, labViewRotation[1].z, labViewRotation[2].z)
  );
  vBakePosition = uLabCoordinateSpace == 0 ? position : worldPosition.xyz;
  vBakeWorldPosition = worldPosition.xyz;
  vBakeWorldNormal = normalize(labInverseViewRotation * (normalMatrix * normal));
  vBakeTriplanarNormal = uLabCoordinateSpace == 0 ? normalize(normal) : vBakeWorldNormal;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const COLOR_SPACE_GLSL = /* glsl */ `
float labLinearChannelToSrgb(float value) {
  float safeValue = max(value, 0.0);
  return safeValue <= 0.0031308
    ? safeValue * 12.92
    : 1.055 * pow(safeValue, 1.0 / 2.4) - 0.055;
}

vec3 labLinearToSrgb(vec3 color) {
  return vec3(
    labLinearChannelToSrgb(color.r),
    labLinearChannelToSrgb(color.g),
    labLinearChannelToSrgb(color.b)
  );
}
`;

const TANGENT_NORMAL_GLSL = /* glsl */ `
vec3 labBakeTangentNormal(vec3 baseNormal, float height) {
  vec3 displacedPosition = vBakeWorldPosition + baseNormal * height;
  vec3 displacedDx = dFdx(displacedPosition);
  vec3 displacedDy = dFdy(displacedPosition);
  vec3 displacedNormal = normalize(cross(displacedDx, displacedDy));
  if (dot(displacedNormal, baseNormal) < 0.0) displacedNormal = -displacedNormal;

  vec3 positionDx = dFdx(vBakeWorldPosition);
  vec3 tangent = positionDx - baseNormal * dot(baseNormal, positionDx);
  if (length(tangent) <= 0.000001) {
    vec3 axis = abs(baseNormal.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    tangent = cross(axis, baseNormal);
  }
  tangent = normalize(tangent);

  vec3 bitangent = normalize(cross(baseNormal, tangent));
  if (dot(bitangent, dFdy(vBakeWorldPosition)) < 0.0) bitangent = -bitangent;

  return normalize(vec3(
    dot(displacedNormal, tangent),
    dot(displacedNormal, bitangent),
    dot(displacedNormal, baseNormal)
  ));
}
`;

function buildSurfaceBakeFragmentGlsl(shared: string, fragment: string): string {
  return /* glsl */ `
${shared}
${fragment}

uniform int uBakeMode;
uniform float uBakeBaseRoughness;
uniform float uBakeBaseMetalness;
uniform float uBakeBaseClearcoat;
uniform float uBakeBaseClearcoatRoughness;

varying vec3 vBakePosition;
varying vec3 vBakeWorldNormal;
varying vec3 vBakeTriplanarNormal;

${COLOR_SPACE_GLSL}

void main() {
  labTriplanarNormal = normalize(vBakeTriplanarNormal);
  LabSurface surface = labEvaluateSurface(vBakePosition);

  vec3 outputColor;
  if (uBakeMode == 0) {
    vec3 sssApproximation = surface.sss > 0.0001
      ? surface.sssColor * surface.sss * 0.22
      : vec3(0.0);
    outputColor = labLinearToSrgb(clamp(surface.color + sssApproximation, 0.0, 1.0));
  } else if (uBakeMode == 1) {
    float roughness = clamp(uBakeBaseRoughness + surface.roughness, 0.045, 1.0);
    outputColor = vec3(roughness);
  } else if (uBakeMode == 4) {
    outputColor = vec3(max(uBakeBaseClearcoat, surface.clearcoat));
  } else if (uBakeMode == 5) {
    float coatRoughness = mix(
      uBakeBaseClearcoatRoughness,
      surface.clearcoatRoughness,
      surface.clearcoat
    );
    outputColor = vec3(clamp(coatRoughness, 0.0, 1.0));
  } else if (uBakeMode == 6) {
    outputColor = vec3(clamp(uBakeBaseMetalness + surface.metallic, 0.0, 1.0));
  } else if (uBakeMode == 7) {
    outputColor = vec3(clamp(surface.ao, 0.0, 1.0));
  } else {
    outputColor = labLinearToSrgb(clamp(surface.emissive, 0.0, 1.0));
  }

  gl_FragColor = vec4(outputColor, 1.0);
}
`;
}

function buildDisplacementBakeFragmentGlsl(shared: string): string {
  return /* glsl */ `
${shared}

uniform int uBakeMode;
uniform float uBakeHeightExtent;

varying vec3 vBakePosition;
varying vec3 vBakeWorldPosition;
varying vec3 vBakeWorldNormal;
varying vec3 vBakeTriplanarNormal;

${TANGENT_NORMAL_GLSL}

void main() {
  labTriplanarNormal = normalize(vBakeTriplanarNormal);
  float height = labEvaluateDisplacement(vBakePosition);

  vec3 outputColor;
  if (uBakeMode == 2) {
    vec3 tangentNormal = labBakeTangentNormal(normalize(vBakeWorldNormal), height);
    outputColor = tangentNormal * 0.5 + 0.5;
  } else {
    float extent = max(uBakeHeightExtent, 0.000001);
    outputColor = vec3(clamp(0.5 + height / (extent * 2.0), 0.0, 1.0));
  }

  gl_FragColor = vec4(outputColor, 1.0);
}
`;
}

function specializeLayerLimit(source: string, layerCount: number): string {
  const count = Math.max(1, Math.min(PTL_MAX_LAYERS, Math.floor(layerCount)));
  if (!LAYER_LIMIT_DIRECTIVE.test(source)) {
    throw new Error('Bake shader is missing its layer limit directive.');
  }
  return source.replace(LAYER_LIMIT_DIRECTIVE, `#define LAB_MAX_LAYERS ${count}`);
}

export function createBakeFragmentGlsl(
  profile: BakeShaderProfile,
  layerCount: number,
  pass: BakeShaderPass = 'surface'
): string {
  const shared = profile === 'compact' ? COMPACT_SHARED_GLSL : PORTABLE_SHARED_GLSL;
  const fragment = profile === 'compact' ? COMPACT_FRAGMENT_GLSL : PORTABLE_FRAGMENT_GLSL;
  const source = pass === 'displacement'
    ? buildDisplacementBakeFragmentGlsl(shared)
    : buildSurfaceBakeFragmentGlsl(shared, fragment);
  return specializeLayerLimit(source, layerCount);
}

export const BAKE_FRAGMENT_GLSL = createBakeFragmentGlsl('portable', PTL_MAX_LAYERS);
