import { rendererSafetyConfig } from '../config/rendererSafetyConfig';
import { structuredPatternConfig } from '../config/structuredPatternConfig';
import {
  DISPLACED_NORMAL_GLSL as BASE_DISPLACED_NORMAL_GLSL,
  FRAGMENT_GLSL as BASE_FRAGMENT_GLSL,
  PHYSICAL_LAYER_GLSL,
  SHADOW_NORMAL_GLSL,
  SHADOW_VERTEX_DISPLACEMENT_GLSL as BASE_SHADOW_VERTEX_DISPLACEMENT_GLSL,
  SHARED_GLSL as BASE_SHARED_GLSL,
  SURFACE_VERTEX_DISPLACEMENT_GLSL as BASE_SURFACE_VERTEX_DISPLACEMENT_GLSL
} from './ProceduralShader';
import { PATTERN_GLSL_HELPERS, PATTERN_GLSL_UNIFORMS } from './PatternShader';

const GEOMETRY_DISPLACEMENT_SOFT_LIMIT =
  rendererSafetyConfig.displacement.geometrySoftLimit.toFixed(8);
const NORMAL_DISPLACEMENT_SOFT_LIMIT =
  rendererSafetyConfig.displacement.normalSoftLimit.toFixed(8);
const NORMAL_DETERMINANT_EPSILON = rendererSafetyConfig.normal.determinantEpsilon.toFixed(12);
const NORMAL_VECTOR_EPSILON_SQUARED = (
  rendererSafetyConfig.normal.vectorEpsilon * rendererSafetyConfig.normal.vectorEpsilon
).toFixed(18);
const STRUCTURED_PORTABLE_AVERAGE_MIX = structuredPatternConfig.projection.portableAverageMix.toFixed(6);
const STRUCTURED_DISPLACEMENT_GAIN = Object.fromEntries(
  Object.entries(structuredPatternConfig.displacementGain).map(([kind, value]) => [kind, value.toFixed(6)])
) as Record<keyof typeof structuredPatternConfig.displacementGain, string>;

const EXTRA_UNIFORMS = `uniform float uLabStochasticTiling;
uniform int uLabCoordinateSpace;
uniform sampler2D uLabSimulationAtlas;
uniform float uLabSimulationReady[LAB_MAX_LAYERS];
uniform vec2 uLabSimulationGrid;
uniform float uLabSimulationCellSize;
uniform float uLabSdfRadius;
uniform float uLabSdfBoxSize;
uniform float uLabSdfEdgeSoftness;
${PATTERN_GLSL_UNIFORMS}`;

const SIMULATION_HELPERS = `
vec2 labSimulationAtlasUv(int layerIndex, vec2 uv) {
  float index = float(layerIndex);
  float column = mod(index, uLabSimulationGrid.x);
  float row = floor(index / uLabSimulationGrid.x);
  float inset = 0.5 / max(uLabSimulationCellSize, 1.0);
  vec2 local = mix(vec2(inset), vec2(1.0 - inset), fract(uv));
  return (vec2(column, row) + local) / uLabSimulationGrid;
}

float labSimulationField(int layerIndex, vec3 p) {
  float xy = texture2D(uLabSimulationAtlas, labSimulationAtlasUv(layerIndex, p.xy)).r;
  float xz = texture2D(uLabSimulationAtlas, labSimulationAtlasUv(layerIndex, p.xz)).r;
  float yz = texture2D(uLabSimulationAtlas, labSimulationAtlasUv(layerIndex, p.yz)).r;
  return (xy + xz + yz) / 3.0;
}
`;

const DISPLACEMENT_HELPERS = `
float labSoftLimitDisplacement(float value, float limit) {
  float scaled = value / limit;
  return value / sqrt(1.0 + scaled * scaled);
}

float labSoftLimitGeometryDisplacement(float value) {
  return labSoftLimitDisplacement(value, ${GEOMETRY_DISPLACEMENT_SOFT_LIMIT});
}

float labSoftLimitNormalDisplacement(float value) {
  return labSoftLimitDisplacement(value, ${NORMAL_DISPLACEMENT_SOFT_LIMIT});
}
`;

function extendPatternShader(source: string): string {
  return source
    .replace(
      `  if (kind == 3) return`,
      `  if (kind == 0) return ${STRUCTURED_DISPLACEMENT_GAIN.brick};\n  if (kind == 1) return ${STRUCTURED_DISPLACEMENT_GAIN.tile};\n  if (kind == 2) return ${STRUCTURED_DISPLACEMENT_GAIN.plank};\n  if (kind == 4) return ${STRUCTURED_DISPLACEMENT_GAIN.pebble};\n  if (kind == 5) return ${STRUCTURED_DISPLACEMENT_GAIN['roof-tile']};\n  if (kind == 6) return ${STRUCTURED_DISPLACEMENT_GAIN.fabric};\n  if (kind == 3) return`
    )
    .replace(
      `  return max(xy, max(xz, yz));\n}`,
      `  float peak = max(xy, max(xz, yz));\n  float average = (xy + xz + yz) / 3.0;\n  return clamp(mix(peak, average, ${STRUCTURED_PORTABLE_AVERAGE_MIX}), 0.0, 1.0);\n}`
    );
}

const PORTABLE_PATTERN_GLSL_HELPERS = extendPatternShader(PATTERN_GLSL_HELPERS);

function extendSharedShader(source: string): string {
  return source
    .replace('uniform float uLabStochasticTiling;', EXTRA_UNIFORMS)
    .replace('float labHash31(vec3 p) {', `${DISPLACEMENT_HELPERS}\nfloat labHash31(vec3 p) {`)
    .replace(
      `  vec3 tile = floor(position * 0.5);\n  vec3 tileWarp = (labHash33(tile + seedOffset) - 0.5) * uLabStochasticTiling;\n  vec3 domain = position + tileWarp;`,
      `  vec3 warpDomain = position * 0.5 + seedOffset * 0.031;\n  vec3 tileWarp = vec3(\n    labNoise3(warpDomain + vec3(11.0, 3.0, 7.0)),\n    labNoise3(warpDomain + vec3(23.0, 17.0, 5.0)),\n    labNoise3(warpDomain + vec3(2.0, 29.0, 19.0))\n  ) - 0.5;\n  vec3 domain = position + tileWarp * uLabStochasticTiling;`
    )
    .replace(
      'float labLayerField(int kind, vec3 position, float scale, float seed) {',
      `${SIMULATION_HELPERS}\n${PORTABLE_PATTERN_GLSL_HELPERS}\nfloat labLayerField(int layerIndex, int kind, vec3 position, float scale, float seed) {`
    )
    .replace(
      `  if (kind == 10) {\n    vec3 q = p + (labFbm3(p * 0.21) - 0.5) * 2.1;\n    float activator = sin(q.x * 1.7 + sin(q.y * 1.3)) * cos(q.z * 1.1 - q.y * 0.7);\n    float inhibitor = labFbm3(q * 0.38 + 19.0);\n    return smoothstep(-0.28, 0.38, activator * 0.62 + inhibitor - 0.5);\n  }`,
      `  if (kind == 10) {\n    if (uLabSimulationReady[layerIndex] > 0.5) return labSimulationField(layerIndex, p * 0.08);\n    vec3 q = p + (labFbm3(p * 0.21) - 0.5) * 2.1;\n    float activator = sin(q.x * 1.7 + sin(q.y * 1.3)) * cos(q.z * 1.1 - q.y * 0.7);\n    float inhibitor = labFbm3(q * 0.38 + 19.0);\n    return smoothstep(-0.28, 0.38, activator * 0.62 + inhibitor - 0.5);\n  }`
    )
    .replace(
      `  if (kind == 11) {\n    float terrain = labFbm3(p * 0.31);\n    float talus = 1.0 - abs(labFbm3(p * 0.82 + 7.0) * 2.0 - 1.0);\n    float sediment = smoothstep(0.18, 0.72, terrain - talus * 0.31 + domain.y * uLabGravity * 0.08);\n    return mix(terrain, sediment, 0.72);\n  }`,
      `  if (kind == 11) {\n    if (uLabSimulationReady[layerIndex] > 0.5) return labSimulationField(layerIndex, p * 0.08);\n    vec3 q = p;\n    float terrain = labFbm3(q * 0.31);\n    float talus = 1.0 - abs(labFbm3(q * 0.82 + 7.0) * 2.0 - 1.0);\n    float sediment = smoothstep(0.18, 0.72, terrain - talus * 0.31 + domain.y * uLabGravity * 0.08);\n    return mix(terrain, sediment, 0.72);\n  }`
    )
    .replace(
      `  vec3 cell = fract(p) - 0.5;\n  float sphere = length(cell) - 0.31;\n  float box = length(max(abs(cell) - vec3(0.25), 0.0)) - 0.055;\n  float sdf = mix(sphere, box, labHash31(floor(p)));\n  return 1.0 - smoothstep(-0.06, 0.18, sdf);`,
      `  if (kind == 13) return labPatternField(layerIndex, p, seed);\n  vec3 cell = fract(p) - 0.5;\n  float sphere = length(cell) - uLabSdfRadius;\n  float box = length(max(abs(cell) - vec3(uLabSdfBoxSize), 0.0)) - uLabSdfEdgeSoftness;\n  float sdf = mix(sphere, box, labHash31(floor(p)));\n  return 1.0 - smoothstep(-uLabSdfEdgeSoftness, uLabSdfEdgeSoftness * 3.0, sdf);`
    )
    .replace(
      `  float mesoField = labLayerField(\n    uLabLayerKind[fieldIndex], position, uLabScale[fieldIndex] * max(uLabMeso, 0.1), uLabSeed[fieldIndex] + 17.0\n  );`,
      `  float mesoField = labLayerField(\n    fieldIndex, uLabLayerKind[fieldIndex], position, uLabScale[fieldIndex] * max(uLabMeso, 0.1), uLabSeed[fieldIndex] + 17.0\n  );`
    )
    .replace(
      `  if (kind == 4 || kind == 5 || kind == 7) {\n    return smoothstep(0.03, 0.92, shaped);\n  }`,
      `  if (kind == 4 || kind == 5 || kind == 7) {\n    return smoothstep(0.03, 0.92, shaped);\n  }\n  if (kind == 13) return smoothstep(0.04, 0.92, shaped);`
    )
    .replace(
      '  if (kind == 4 || kind == 5 || kind == 7) return shaped;',
      '  if (kind == 4 || kind == 5 || kind == 7 || kind == 13) return shaped;'
    )
    .replace(
      `        labDisplacementGainForKind(kind) *\n        opacityBase *`,
      `        labDisplacementGainForKind(kind) *\n        labPatternDisplacementGain(i) *\n        opacityBase *`
    )
    .replace('  return displacement;\n}', '  return labSoftLimitGeometryDisplacement(displacement);\n}');
}

function extendFragmentShader(source: string): string {
  return source
    .replace(
      `        labDisplacementGainForKind(kind) *\n        opacityBase *`,
      `        labDisplacementGainForKind(kind) *\n        labPatternDisplacementGain(i) *\n        opacityBase *`
    )
    .replace(
      '  if (surface.sss > 0.0001) surface.sssColor /= surface.sss;',
      '  surface.displacement = labSoftLimitNormalDisplacement(surface.displacement);\n  if (surface.sss > 0.0001) surface.sssColor /= surface.sss;'
    );
}

function extendDisplacedNormalShader(source: string): string {
  return source
    .replace(
      'if (abs(labDeterminant) > 0.00000001) {',
      `if (abs(labDeterminant) > ${NORMAL_DETERMINANT_EPSILON}) {`
    )
    .replace(
      `    vec3 labWorldNormal = normalize(\n      abs(labDeterminant) * labBaseWorldNormal - labSurfaceGradient * uLabNormalStrength\n    );`,
      `    vec3 labNormalCandidate =\n      abs(labDeterminant) * labBaseWorldNormal - labSurfaceGradient * uLabNormalStrength;\n    float labNormalCandidateLengthSq = dot(labNormalCandidate, labNormalCandidate);\n    vec3 labWorldNormal = labNormalCandidateLengthSq > ${NORMAL_VECTOR_EPSILON_SQUARED}\n      ? labNormalCandidate * inversesqrt(labNormalCandidateLengthSq)\n      : labBaseWorldNormal;`
    );
}

function addCoordinatePolicy(source: string): string {
  return source
    .replace(
      'float labDisplacement = labEvaluateDisplacement(labPosition);',
      `vec3 labSamplePosition = uLabCoordinateSpace == 0 ? transformed : labPosition;\nfloat labDisplacement = labEvaluateDisplacement(labSamplePosition);`
    )
    .replace('vLabPosition = labPosition;', 'vLabPosition = labSamplePosition;');
}

export const SHARED_GLSL = extendSharedShader(BASE_SHARED_GLSL);
export const FRAGMENT_GLSL = extendFragmentShader(BASE_FRAGMENT_GLSL);
export { PHYSICAL_LAYER_GLSL, SHADOW_NORMAL_GLSL };
export const SURFACE_VERTEX_DISPLACEMENT_GLSL = addCoordinatePolicy(BASE_SURFACE_VERTEX_DISPLACEMENT_GLSL);
export const SHADOW_VERTEX_DISPLACEMENT_GLSL = addCoordinatePolicy(BASE_SHADOW_VERTEX_DISPLACEMENT_GLSL);
export const DISPLACED_NORMAL_GLSL = extendDisplacedNormalShader(BASE_DISPLACED_NORMAL_GLSL);
