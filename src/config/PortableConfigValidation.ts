import {
  PTL_DEFAULT_PHYSICAL,
  PTL_DEFAULT_SYNTHESIS,
  PTL_GROUP_LIMITS,
  PTL_LAYER_LIMITS,
  PTL_MAX_GROUP_DEPTH,
  PTL_MAX_GROUP_NAME_LENGTH,
  PTL_MAX_GROUPS,
  PTL_MAX_LAYER_NAME_LENGTH,
  PTL_MAX_LAYERS,
  PTL_PHYSICAL_LIMITS,
  PTL_SHADER_DEFAULTS,
  PTL_SYNTHESIS_LIMITS
} from '../core/material/runtimeDefaults';
import type { PhysicalSettings, SynthesisSettings } from '../materials/types';

interface Range {
  min: number;
  max: number;
}

interface PortableCompatibleConfig {
  app: {
    maxLayers: number;
    maxGroups: number;
    maxGroupDepth: number;
    maxLayerNameLength: number;
    maxGroupNameLength: number;
  };
  controls: {
    layer: Record<keyof typeof PTL_LAYER_LIMITS, Range>;
    group: { opacity: Range };
    physical: Record<keyof typeof PTL_PHYSICAL_LIMITS, Range>;
    synthesis: Record<keyof typeof PTL_SYNTHESIS_LIMITS, Range>;
  };
  defaults: {
    physical: PhysicalSettings;
    synthesis: SynthesisSettings;
  };
  renderer: {
    displacedNormalStrength: number;
    sssLightDirection: readonly [number, number, number];
    sssBackscatterStrength: number;
    sssThicknessScale: number;
  };
}

const PHYSICAL_NUMBER_KEYS: ReadonlyArray<keyof typeof PTL_PHYSICAL_LIMITS> = [
  'roughness',
  'metalness',
  'clearcoat',
  'clearcoatRoughness',
  'specularIntensity',
  'ior',
  'sheen',
  'sheenRoughness',
  'transmission',
  'thickness',
  'attenuationDistance'
];

function assertEqual(actual: number, expected: number, label: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label} must match the portable runtime contract (${expected}).`);
  }
}

function assertString(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} must match the portable runtime contract (${expected}).`);
  }
}

function assertRange(actual: Readonly<Range>, expected: Readonly<Range>, label: string): void {
  assertEqual(actual.min, expected.min, `${label}.min`);
  assertEqual(actual.max, expected.max, `${label}.max`);
}

export function assertPortableConfigCompatibility(config: Readonly<PortableCompatibleConfig>): void {
  assertEqual(config.app.maxLayers, PTL_MAX_LAYERS, 'app.maxLayers');
  assertEqual(config.app.maxGroups, PTL_MAX_GROUPS, 'app.maxGroups');
  assertEqual(config.app.maxGroupDepth, PTL_MAX_GROUP_DEPTH, 'app.maxGroupDepth');
  assertEqual(config.app.maxLayerNameLength, PTL_MAX_LAYER_NAME_LENGTH, 'app.maxLayerNameLength');
  assertEqual(config.app.maxGroupNameLength, PTL_MAX_GROUP_NAME_LENGTH, 'app.maxGroupNameLength');

  for (const key of Object.keys(PTL_LAYER_LIMITS) as Array<keyof typeof PTL_LAYER_LIMITS>) {
    assertRange(config.controls.layer[key], PTL_LAYER_LIMITS[key], `controls.layer.${key}`);
  }
  assertRange(config.controls.group.opacity, PTL_GROUP_LIMITS.opacity, 'controls.group.opacity');
  for (const key of PHYSICAL_NUMBER_KEYS) {
    assertRange(config.controls.physical[key], PTL_PHYSICAL_LIMITS[key], `controls.physical.${key}`);
    assertEqual(config.defaults.physical[key], PTL_DEFAULT_PHYSICAL[key], `defaults.physical.${key}`);
  }
  for (const key of Object.keys(PTL_SYNTHESIS_LIMITS) as Array<keyof typeof PTL_SYNTHESIS_LIMITS>) {
    assertRange(config.controls.synthesis[key], PTL_SYNTHESIS_LIMITS[key], `controls.synthesis.${key}`);
    assertEqual(config.defaults.synthesis[key], PTL_DEFAULT_SYNTHESIS[key], `defaults.synthesis.${key}`);
  }
  assertString(
    config.defaults.physical.sheenColor,
    PTL_DEFAULT_PHYSICAL.sheenColor,
    'defaults.physical.sheenColor'
  );
  assertString(
    config.defaults.physical.attenuationColor,
    PTL_DEFAULT_PHYSICAL.attenuationColor,
    'defaults.physical.attenuationColor'
  );

  assertEqual(
    config.renderer.displacedNormalStrength,
    PTL_SHADER_DEFAULTS.normalStrength,
    'renderer.displacedNormalStrength'
  );
  for (let index = 0; index < 3; index += 1) {
    assertEqual(
      config.renderer.sssLightDirection[index] ?? Number.NaN,
      PTL_SHADER_DEFAULTS.sssLightDirection[index] ?? Number.NaN,
      `renderer.sssLightDirection[${index}]`
    );
  }
  assertEqual(
    config.renderer.sssBackscatterStrength,
    PTL_SHADER_DEFAULTS.sssBackscatterStrength,
    'renderer.sssBackscatterStrength'
  );
  assertEqual(
    config.renderer.sssThicknessScale,
    PTL_SHADER_DEFAULTS.sssThicknessScale,
    'renderer.sssThicknessScale'
  );
}
