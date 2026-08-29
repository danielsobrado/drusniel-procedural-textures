import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import {
  RUNTIME_RENDERER_SAFETY_CONFIG as rendererSafetyConfig,
  RUNTIME_STRUCTURED_PATTERN_CONFIG as structuredPatternConfig,
  RUNTIME_TEXTURE_FIELD_CONFIG as textureFieldConfig
} from '../core/material/generated/runtimeConfig';
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
const TEXTURE_FIELD_TRIPLANAR_SHARPNESS = textureFieldConfig.projection.sharpness.toFixed(6);
const TEXTURE_FIELD_TRIPLANAR_MIN_WEIGHT = textureFieldConfig.projection.minWeight.toFixed(6);
const STRUCTURED_DISPLACEMENT_GAIN = Object.fromEntries(
  Object.entries(structuredPatternConfig.displacementGain).map(([kind, value]) => [kind, value.toFixed(6)])
) as Record<keyof typeof structuredPatternConfig.displacementGain, string>;

/**
 * `labPatternDisplacementGain` reads `uLabPatternKind`, which the compiler fills with the
 * default `brick` code in every slot and only overwrites for real pattern layers. Guarding on
 * the layer kind keeps the gain off non-pattern layers, matching `designerDisplacementGain`
 * in the TSL path and `signalExtent` in `MaterialDisplacement`. Layer kind 13 is `pattern`.
 */
const PATTERN_DISPLACEMENT_GAIN_TERM = '(kind == 13 ? labPatternDisplacementGain(i) : 1.0)';

const EXTRA_UNIFORMS = `uniform float uLabStochasticTiling;
uniform int uLabCoordinateSpace;
uniform sampler2D uLabSimulationAtlas;
uniform float uLabSimulationReady[LAB_MAX_LAYERS];
uniform vec2 uLabSimulationGrid;
uniform float uLabSimulationCellSize;
uniform float uLabSdfRadius;
uniform float uLabSdfBoxSize;
uniform float uLabSdfEdgeSoftness;
uniform sampler2D uLabTextureFields[LAB_MAX_LAYERS];
uniform vec4 uLabTextureTransform[LAB_MAX_LAYERS];
uniform vec4 uLabTextureAdjust[LAB_MAX_LAYERS];
uniform int uLabTextureChannel[LAB_MAX_LAYERS];
uniform float uLabTextureClamp[LAB_MAX_LAYERS];
uniform int uLabTextureMode[LAB_MAX_LAYERS];
uniform float uLabTextureModeAmount[LAB_MAX_LAYERS];
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

const TEXTURE_FIELD_SAMPLER_BRANCHES = Array.from(
  { length: PTL_MAX_LAYERS },
  (_, layer) => [
    `#if LAB_MAX_LAYERS > ${layer}`,
    `  if (layerIndex == ${layer}) return texture2D(uLabTextureFields[${layer}], uv);`,
    '#endif'
  ].join('\n')
).join('\n');

const TEXTURE_FIELD_HELPERS = `
vec2 labTextureFieldUv(int layerIndex, vec2 uv) {
  vec4 transform = uLabTextureTransform[layerIndex];
  vec4 adjust = uLabTextureAdjust[layerIndex];
  vec2 centered = uv - 0.5;
  float c = cos(adjust.x);
  float s = sin(adjust.x);
  vec2 rotated = vec2(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  );
  return rotated * transform.xy + 0.5 + transform.zw;
}

float labTextureFieldChannel(int layerIndex, vec4 sampleValue) {
  int channel = uLabTextureChannel[layerIndex];
  if (channel == 1) return sampleValue.g;
  if (channel == 2) return sampleValue.b;
  if (channel == 3) return sampleValue.a;
  if (channel == 4) return dot(sampleValue.rgb, vec3(0.2126, 0.7152, 0.0722));
  return sampleValue.r;
}

// GLSL ES 1.00 requires a literal constant index into a sampler array; ANGLE rejects even a
// for-loop index. The branches are therefore unrolled with literal indices, and each one is
// guarded by the preprocessor so the body stays valid when the bake shader specializes
// LAB_MAX_LAYERS down to the material's actual layer count (see specializeLayerLimit).
vec4 labTextureFieldTexel(int layerIndex, vec2 uv) {
${TEXTURE_FIELD_SAMPLER_BRANCHES}
  return vec4(0.0);
}

float labTextureFieldSample(int layerIndex, vec2 uv) {
  return labTextureFieldChannel(layerIndex, labTextureFieldTexel(layerIndex, labTextureFieldUv(layerIndex, uv)));
}

float labTextureField(int layerIndex, vec3 p) {
  vec3 weights = pow(abs(labTriplanarNormal), vec3(${TEXTURE_FIELD_TRIPLANAR_SHARPNESS}));
  weights *= step(vec3(${TEXTURE_FIELD_TRIPLANAR_MIN_WEIGHT}), weights);
  float totalWeight = max(dot(weights, vec3(1.0)), 0.000001);
  // All three projections are sampled unconditionally. Branching on the weights would put an
  // implicit-LOD fetch inside non-uniform control flow, where the derivatives that select the
  // mip level are undefined; a zero weight already drops the projection from the sum.
  float value = (
    labTextureFieldSample(layerIndex, p.xy) * weights.z +
    labTextureFieldSample(layerIndex, p.xz) * weights.y +
    labTextureFieldSample(layerIndex, p.yz) * weights.x
  ) / totalWeight;
  vec4 adjust = uLabTextureAdjust[layerIndex];
  value = 0.5 + (value - 0.5) * adjust.y + adjust.z;
  if (adjust.w > 0.5) value = 1.0 - value;
  return mix(value, clamp(value, 0.0, 1.0), uLabTextureClamp[layerIndex]);
}
`;

const TEXTURE_MODE_HELPERS = `
float labLayerField(int layerIndex, int kind, vec3 position, float scale, float seed) {
  int textureMode = uLabTextureMode[layerIndex];
  if (textureMode == 0) return labGeneratorField(layerIndex, kind, position, scale, seed);

  vec3 seedOffset = vec3(seed * 0.71, seed * 1.17, seed * 1.91);
  vec3 warpDomain = position * 0.5 + seedOffset * 0.031;
  vec3 tileWarp = vec3(
    labNoise3(warpDomain + vec3(11.0, 3.0, 7.0)),
    labNoise3(warpDomain + vec3(23.0, 17.0, 5.0)),
    labNoise3(warpDomain + vec3(2.0, 29.0, 19.0))
  ) - 0.5;
  vec3 domain = position + tileWarp * uLabStochasticTiling;
  float safeScale = max(scale, 0.001);
  float textureField = labTextureField(layerIndex, domain * safeScale + seedOffset);
  float amount = max(uLabTextureModeAmount[layerIndex], 0.0);

  if (textureMode == 1) return textureField;

  vec3 generatorPosition = position;
  if (textureMode == 3) {
    generatorPosition += vec3((textureField - 0.5) * amount / safeScale);
  }
  float generatorField = labGeneratorField(layerIndex, kind, generatorPosition, scale, seed);
  if (textureMode == 2) {
    return clamp(generatorField * mix(1.0, textureField * 2.0, amount), 0.0, 1.0);
  }
  if (textureMode == 4) {
    return clamp(generatorField + (textureField - 0.5) * amount, 0.0, 1.0);
  }
  return generatorField;
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

/**
 * The portable shader is not a shader; it is a set of exact-string patches over the base
 * GLSL. A search string that no longer matches would return the source unchanged, silently
 * diverging the portable path from the base path rather than failing. Every patch therefore
 * asserts it applied.
 */
type ShaderPatch = readonly [
  label: string,
  search: string,
  replacement: string,
  optional?: boolean
];

/**
 * `optional` marks a patch that legitimately does not apply to every shader it is run over.
 * `addCoordinatePolicy` patches both the surface and shadow vertex shaders, and only the
 * surface one carries the `vLabPosition` varying. Everything else must apply.
 */
export function applyPatches(source: string, patches: readonly ShaderPatch[]): string {
  return patches.reduce((current, [label, search, replacement, optional]) => {
    if (!current.includes(search)) {
      if (optional === true) return current;
      throw new Error(
        `Portable shader patch "${label}" no longer matches the base shader. ` +
        'The base GLSL changed shape; update the patch to match it.'
      );
    }
    return current.replace(search, replacement);
  }, source);
}

function extendPatternShader(source: string): string {
  return applyPatches(source, [
    [
      'structured pattern displacement gain',
      `  if (kind == 3) return`,
      `  if (kind == 0) return ${STRUCTURED_DISPLACEMENT_GAIN.brick};\n  if (kind == 1) return ${STRUCTURED_DISPLACEMENT_GAIN.tile};\n  if (kind == 2) return ${STRUCTURED_DISPLACEMENT_GAIN.plank};\n  if (kind == 4) return ${STRUCTURED_DISPLACEMENT_GAIN.pebble};\n  if (kind == 5) return ${STRUCTURED_DISPLACEMENT_GAIN['roof-tile']};\n  if (kind == 6) return ${STRUCTURED_DISPLACEMENT_GAIN.fabric};\n  if (kind == 3) return`
    ],
    // A patch softening the structured triplanar seam used to sit here, mixing the hard
    // `max(xy, max(xz, yz))` towards a flat three-projection average. `labPatternField` now
    // weights the projections by the surface normal, the same way the TSL path does, so there
    // is no seam left to soften and no `max` left to match.
  ]);
}

const PORTABLE_PATTERN_GLSL_HELPERS = extendPatternShader(PATTERN_GLSL_HELPERS);

function extendSharedShader(source: string): string {
  return applyPatches(source, [
    ['portable uniforms', 'uniform float uLabStochasticTiling;', EXTRA_UNIFORMS],
    [
      'displacement soft limits',
      'float labHash31(vec3 p) {',
      `${DISPLACEMENT_HELPERS}\nfloat labHash31(vec3 p) {`
    ],
    [
      'stochastic tiling domain warp',
      `  vec3 tile = floor(position * 0.5);\n  vec3 tileWarp = (labHash33(tile + seedOffset) - 0.5) * uLabStochasticTiling;\n  vec3 domain = position + tileWarp;`,
      `  vec3 warpDomain = position * 0.5 + seedOffset * 0.031;\n  vec3 tileWarp = vec3(\n    labNoise3(warpDomain + vec3(11.0, 3.0, 7.0)),\n    labNoise3(warpDomain + vec3(23.0, 17.0, 5.0)),\n    labNoise3(warpDomain + vec3(2.0, 29.0, 19.0))\n  ) - 0.5;\n  vec3 domain = position + tileWarp * uLabStochasticTiling;`
    ],
    [
      'generator field signature',
      'float labLayerField(int kind, vec3 position, float scale, float seed) {',
      `${SIMULATION_HELPERS}\n${TEXTURE_FIELD_HELPERS}\n${PORTABLE_PATTERN_GLSL_HELPERS}\nfloat labGeneratorField(int layerIndex, int kind, vec3 position, float scale, float seed) {`
    ],
    [
      'reaction diffusion simulation atlas',
      `  if (kind == 10) {\n    vec3 q = p + (labFbm3(p * 0.21) - 0.5) * 2.1;\n    float activator = sin(q.x * 1.7 + sin(q.y * 1.3)) * cos(q.z * 1.1 - q.y * 0.7);\n    float inhibitor = labFbm3(q * 0.38 + 19.0);\n    return smoothstep(-0.28, 0.38, activator * 0.62 + inhibitor - 0.5);\n  }`,
      `  if (kind == 10) {\n    if (uLabSimulationReady[layerIndex] > 0.5) return labSimulationField(layerIndex, p * 0.08);\n    vec3 q = p + (labFbm3(p * 0.21) - 0.5) * 2.1;\n    float activator = sin(q.x * 1.7 + sin(q.y * 1.3)) * cos(q.z * 1.1 - q.y * 0.7);\n    float inhibitor = labFbm3(q * 0.38 + 19.0);\n    return smoothstep(-0.28, 0.38, activator * 0.62 + inhibitor - 0.5);\n  }`
    ],
    [
      'erosion simulation atlas',
      `  if (kind == 11) {\n    float terrain = labFbm3(p * 0.31);\n    float talus = 1.0 - abs(labFbm3(p * 0.82 + 7.0) * 2.0 - 1.0);\n    float sediment = smoothstep(0.18, 0.72, terrain - talus * 0.31 + domain.y * uLabGravity * 0.08);\n    return mix(terrain, sediment, 0.72);\n  }`,
      `  if (kind == 11) {\n    if (uLabSimulationReady[layerIndex] > 0.5) return labSimulationField(layerIndex, p * 0.08);\n    vec3 q = p;\n    float terrain = labFbm3(q * 0.31);\n    float talus = 1.0 - abs(labFbm3(q * 0.82 + 7.0) * 2.0 - 1.0);\n    float sediment = smoothstep(0.18, 0.72, terrain - talus * 0.31 + domain.y * uLabGravity * 0.08);\n    return mix(terrain, sediment, 0.72);\n  }`
    ],
    [
      'pattern field and configurable sdf',
      `  vec3 cell = fract(p) - 0.5;\n  float sphere = length(cell) - 0.31;\n  float box = length(max(abs(cell) - vec3(0.25), 0.0)) - 0.055;\n  float sdf = mix(sphere, box, labHash31(floor(p)));\n  return 1.0 - smoothstep(-0.06, 0.18, sdf);`,
      `  if (kind == 13) return labPatternField(layerIndex, p, seed);\n  vec3 cell = fract(p) - 0.5;\n  float sphere = length(cell) - uLabSdfRadius;\n  float box = length(max(abs(cell) - vec3(uLabSdfBoxSize), 0.0)) - uLabSdfEdgeSoftness;\n  float sdf = mix(sphere, box, labHash31(floor(p)));\n  return 1.0 - smoothstep(-uLabSdfEdgeSoftness, uLabSdfEdgeSoftness * 3.0, sdf);`
    ],
    [
      'texture mode helpers',
      'float labFieldForLayer(int layerIndex, vec3 position) {',
      `${TEXTURE_MODE_HELPERS}\nfloat labFieldForLayer(int layerIndex, vec3 position) {`
    ],
    [
      'layer-indexed meso field',
      `  float mesoField = labLayerField(\n    uLabLayerKind[fieldIndex], position, uLabScale[fieldIndex] * max(uLabMeso, 0.1), uLabSeed[fieldIndex] + 17.0\n  );`,
      `  float mesoField = labLayerField(\n    fieldIndex, uLabLayerKind[fieldIndex], position, uLabScale[fieldIndex] * max(uLabMeso, 0.1), uLabSeed[fieldIndex] + 17.0\n  );`
    ],
    [
      'pattern layer coverage',
      `  if (kind == 4 || kind == 5 || kind == 7) {\n    return smoothstep(0.03, 0.92, shaped);\n  }`,
      `  if (kind == 4 || kind == 5 || kind == 7) {\n    return smoothstep(0.03, 0.92, shaped);\n  }\n  if (kind == 13) return smoothstep(0.04, 0.92, shaped);`
    ],
    [
      'pattern displacement signal',
      '  if (kind == 4 || kind == 5 || kind == 7) return shaped;',
      '  if (kind == 4 || kind == 5 || kind == 7 || kind == 13) return shaped;'
    ],
    [
      'pattern zero-baseline relief',
      '  return kind == 4 || kind == 5 || kind == 7;',
      '  return kind == 4 || kind == 5 || kind == 7 || kind == 13;'
    ],
    [
      'pattern displacement gain in displacement pass',
      `      labDisplacementGainForKind(kind) *\n      opacityBase *`,
      `      labDisplacementGainForKind(kind) *\n      ${PATTERN_DISPLACEMENT_GAIN_TERM} *\n      opacityBase *`
    ],
    [
      'geometry displacement soft limit',
      '  return displacement;\n}',
      '  return labSoftLimitGeometryDisplacement(displacement);\n}'
    ]
  ]);
}

function extendFragmentShader(source: string): string {
  return applyPatches(source, [
    [
      'pattern displacement gain in surface pass',
      `        labDisplacementGainForKind(kind) *\n        opacityBase *`,
      `        labDisplacementGainForKind(kind) *\n        ${PATTERN_DISPLACEMENT_GAIN_TERM} *\n        opacityBase *`
    ],
    [
      'normal displacement soft limit',
      '  if (surface.sss > 0.0001) surface.sssColor /= surface.sss;',
      '  surface.displacement = labSoftLimitNormalDisplacement(surface.displacement);\n  if (surface.sss > 0.0001) surface.sssColor /= surface.sss;'
    ]
  ]);
}

function extendDisplacedNormalShader(source: string): string {
  return applyPatches(source, [
    [
      'normal determinant epsilon',
      'if (abs(labDeterminant) > 0.00000001) {',
      `if (abs(labDeterminant) > ${NORMAL_DETERMINANT_EPSILON}) {`
    ],
    [
      'degenerate normal fallback',
      `    vec3 labWorldNormal = normalize(\n      abs(labDeterminant) * labBaseWorldNormal - labSurfaceGradient * uLabNormalStrength\n    );`,
      `    vec3 labNormalCandidate =\n      abs(labDeterminant) * labBaseWorldNormal - labSurfaceGradient * uLabNormalStrength;\n    float labNormalCandidateLengthSq = dot(labNormalCandidate, labNormalCandidate);\n    vec3 labWorldNormal = labNormalCandidateLengthSq > ${NORMAL_VECTOR_EPSILON_SQUARED}\n      ? labNormalCandidate * inversesqrt(labNormalCandidateLengthSq)\n      : labBaseWorldNormal;`
    ]
  ]);
}

function addCoordinatePolicy(source: string): string {
  return applyPatches(source, [
    [
      'coordinate space sample position',
      'float labDisplacement = labEvaluateDisplacement(labPosition);',
      'vec3 labSamplePosition = uLabCoordinateSpace == 0 ? transformed : labPosition;'
    ],
    [
      'triplanar sampling normal',
      'float labWorldDeterminant = dot(labWorldA, labCofactorX);',
      `float labWorldDeterminant = dot(labWorldA, labCofactorX);\nlabTriplanarNormal = normalize(objectNormal);\nif (uLabCoordinateSpace != 0 && abs(labWorldDeterminant) > 0.00000001) {\n  vec3 labWorldSamplingNormal = mat3(labCofactorX, labCofactorY, labCofactorZ) * objectNormal;\n  if (labWorldDeterminant < 0.0) labWorldSamplingNormal = -labWorldSamplingNormal;\n  labTriplanarNormal = normalize(labWorldSamplingNormal);\n}\nfloat labDisplacement = labEvaluateDisplacement(labSamplePosition);`
    ],
    [
      'varying sample position',
      'vLabPosition = labPosition;',
      'vLabPosition = labSamplePosition;',
      true
    ]
  ]);
}

function exposeSurfaceTriplanarNormal(source: string): string {
  return applyPatches(source, [
    [
      'varying triplanar normal',
      'vLabPosition = labSamplePosition;',
      'vLabPosition = labSamplePosition;\nvLabTriplanarNormal = labTriplanarNormal;'
    ]
  ]);
}

export const SHARED_GLSL = extendSharedShader(BASE_SHARED_GLSL);
export const FRAGMENT_GLSL = extendFragmentShader(BASE_FRAGMENT_GLSL);
export { PHYSICAL_LAYER_GLSL, SHADOW_NORMAL_GLSL };
export const SURFACE_VERTEX_DISPLACEMENT_GLSL = exposeSurfaceTriplanarNormal(
  addCoordinatePolicy(BASE_SURFACE_VERTEX_DISPLACEMENT_GLSL)
);
export const SHADOW_VERTEX_DISPLACEMENT_GLSL = addCoordinatePolicy(BASE_SHADOW_VERTEX_DISPLACEMENT_GLSL);
export const DISPLACED_NORMAL_GLSL = extendDisplacedNormalShader(BASE_DISPLACED_NORMAL_GLSL);
