import { FRAGMENT_GLSL, SHARED_GLSL } from '../materials/ProceduralShader';

export const BAKE_VERTEX_GLSL = /* glsl */ `
varying vec3 vBakePosition;
varying vec3 vBakeWorldPosition;
varying vec3 vBakeWorldNormal;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vBakePosition = worldPosition.xyz;
  vBakeWorldPosition = worldPosition.xyz;
  vBakeWorldNormal = normalize(normalMatrix * normal);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BAKE_FRAGMENT_GLSL = /* glsl */ `
${SHARED_GLSL}
${FRAGMENT_GLSL}

uniform int uBakeMode;
uniform float uBakeBaseRoughness;
uniform float uBakeBaseClearcoat;
uniform float uBakeBaseClearcoatRoughness;
uniform float uBakeHeightExtent;

varying vec3 vBakePosition;
varying vec3 vBakeWorldPosition;
varying vec3 vBakeWorldNormal;

vec3 labLinearToSrgb(vec3 color) {
  vec3 low = color * 12.92;
  vec3 high = 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, lessThanEqual(color, vec3(0.0031308)));
}

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

void main() {
  LabSurface surface = labEvaluateSurface(vBakePosition);
  float height = labEvaluateDisplacement(vBakePosition);

  vec3 outputColor;
  if (uBakeMode == 0) {
    outputColor = labLinearToSrgb(clamp(surface.color, 0.0, 1.0));
  } else if (uBakeMode == 1) {
    float roughness = clamp(uBakeBaseRoughness + surface.roughness, 0.045, 1.0);
    outputColor = vec3(roughness);
  } else if (uBakeMode == 2) {
    vec3 tangentNormal = labBakeTangentNormal(normalize(vBakeWorldNormal), height);
    outputColor = tangentNormal * 0.5 + 0.5;
  } else if (uBakeMode == 3) {
    float extent = max(uBakeHeightExtent, 0.000001);
    outputColor = vec3(clamp(0.5 + height / (extent * 2.0), 0.0, 1.0));
  } else if (uBakeMode == 4) {
    outputColor = vec3(max(uBakeBaseClearcoat, surface.clearcoat));
  } else {
    float coatRoughness = mix(
      uBakeBaseClearcoatRoughness,
      surface.clearcoatRoughness,
      surface.clearcoat
    );
    outputColor = vec3(clamp(coatRoughness, 0.0, 1.0));
  }

  gl_FragColor = vec4(outputColor, 1.0);
}
`;
