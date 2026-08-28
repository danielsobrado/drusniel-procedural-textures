import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  DEFAULT_MATERIAL_ALGORITHMS,
  type MaterialAlgorithmSettings
} from '../core/material/MaterialAlgorithms';
import { DEFAULT_PATTERN_SETTINGS } from '../core/material/PatternSettings';
import { PTL_MAX_LAYERS, PTL_SHADER_DEFAULTS } from '../core/material/runtimeDefaults';
import type {
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';
import { derivePatternParams, type PatternParamNodes } from './WebGpuPatternNodes';

const DEFAULT_PATTERN_PARAMS = derivePatternParams(DEFAULT_PATTERN_SETTINGS);

function effectiveGroupOpacity(
  groupId: string | null,
  groups: ReadonlyMap<string, MaterialGroup>
): number {
  let opacity = 1;
  let currentId = groupId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (visited.has(currentId)) return 0;
    visited.add(currentId);
    const group = groups.get(currentId);
    if (group === undefined || !group.enabled) return 0;
    opacity *= group.opacity;
    currentId = group.parentId;
  }
  return opacity;
}

function uniformArray(value: number) {
  return Array.from({ length: PTL_MAX_LAYERS }, () => uniform(value));
}

export class WebGpuMaterialUniforms {
  public readonly enabled = uniformArray(0);
  public readonly opacity = uniformArray(0);
  public readonly scale = uniformArray(1);
  public readonly strength = uniformArray(1);
  public readonly seed = uniformArray(1);
  public readonly colorA = Array.from(
    { length: PTL_MAX_LAYERS },
    () => uniform(new THREE.Color('#000000'))
  );
  public readonly colorB = Array.from(
    { length: PTL_MAX_LAYERS },
    () => uniform(new THREE.Color('#000000'))
  );
  public readonly roughness = uniformArray(0);
  public readonly displacement = uniformArray(0);
  public readonly groupOpacity = uniformArray(1);
  public readonly maskInvert = uniformArray(0);
  public readonly maskStrength = uniformArray(1);

  public readonly pattern_rotationRadians = uniformArray(DEFAULT_PATTERN_PARAMS.rotationRadians);
  public readonly pattern_density = uniformArray(DEFAULT_PATTERN_PARAMS.density);
  public readonly pattern_grassJitterOffset = uniformArray(DEFAULT_PATTERN_PARAMS.grassJitterOffset);
  public readonly pattern_grassBladeLength = uniformArray(DEFAULT_PATTERN_PARAMS.grassBladeLength);
  public readonly pattern_grassBladeWidth = uniformArray(DEFAULT_PATTERN_PARAMS.grassBladeWidth);
  public readonly pattern_grassBladeTaper = uniformArray(DEFAULT_PATTERN_PARAMS.grassBladeTaper);
  public readonly pattern_grassBladeBend = uniformArray(DEFAULT_PATTERN_PARAMS.grassBladeBend);
  public readonly pattern_grassBladeCurvature = uniformArray(DEFAULT_PATTERN_PARAMS.grassBladeCurvature);
  public readonly pattern_grassClumpScale = uniformArray(DEFAULT_PATTERN_PARAMS.grassClumpScale);
  public readonly pattern_grassClumpStrength = uniformArray(DEFAULT_PATTERN_PARAMS.grassClumpStrength);
  public readonly pattern_grassDirectionality = uniformArray(DEFAULT_PATTERN_PARAMS.grassDirectionality);
  public readonly pattern_grassDryness = uniformArray(DEFAULT_PATTERN_PARAMS.grassDryness);
  public readonly pattern_grassTipFade = uniformArray(DEFAULT_PATTERN_PARAMS.grassTipFade);
  public readonly pattern_grassRootDarkening = uniformArray(DEFAULT_PATTERN_PARAMS.grassRootDarkening);
  public readonly pattern_grassHeightJitter = uniformArray(DEFAULT_PATTERN_PARAMS.grassHeightJitter);
  public readonly pattern_grassWidthJitter = uniformArray(DEFAULT_PATTERN_PARAMS.grassWidthJitter);
  public readonly pattern_grassLeanJitter = uniformArray(DEFAULT_PATTERN_PARAMS.grassLeanJitter);
  public readonly pattern_grassEdgeWear = uniformArray(DEFAULT_PATTERN_PARAMS.grassEdgeWear);
  public readonly pattern_turfFiberLength = uniformArray(DEFAULT_PATTERN_PARAMS.turfFiberLength);
  public readonly pattern_turfFiberWidth = uniformArray(DEFAULT_PATTERN_PARAMS.turfFiberWidth);
  public readonly pattern_turfFiberBreakup = uniformArray(DEFAULT_PATTERN_PARAMS.turfFiberBreakup);
  public readonly pattern_turfFiberSoftness = uniformArray(DEFAULT_PATTERN_PARAMS.turfFiberSoftness);
  public readonly pattern_pebbleJitterOffset = uniformArray(DEFAULT_PATTERN_PARAMS.pebbleJitterOffset);
  public readonly pattern_pebbleJitterRotate = uniformArray(DEFAULT_PATTERN_PARAMS.pebbleJitterRotate);
  public readonly pattern_pebbleRadiusScale = uniformArray(DEFAULT_PATTERN_PARAMS.pebbleRadiusScale);
  public readonly pattern_pebbleXScale = uniformArray(DEFAULT_PATTERN_PARAMS.pebbleXScale);
  public readonly pattern_pebbleWear = uniformArray(DEFAULT_PATTERN_PARAMS.pebbleWear);
  public readonly pattern_fabricWidth = uniformArray(DEFAULT_PATTERN_PARAMS.fabricWidth);
  public readonly pattern_fabricWidthUpper = uniformArray(DEFAULT_PATTERN_PARAMS.fabricWidthUpper);
  public readonly pattern_aspectDivisor = uniformArray(DEFAULT_PATTERN_PARAMS.aspectDivisor);
  public readonly pattern_offset = uniformArray(DEFAULT_PATTERN_PARAMS.offset);
  public readonly pattern_cellJitterOffset = uniformArray(DEFAULT_PATTERN_PARAMS.cellJitterOffset);
  public readonly pattern_cellInnerHalf = uniformArray(DEFAULT_PATTERN_PARAMS.cellInnerHalf);
  public readonly pattern_cellRadius = uniformArray(DEFAULT_PATTERN_PARAMS.cellRadius);
  public readonly pattern_cellWear = uniformArray(DEFAULT_PATTERN_PARAMS.cellWear);

  public patternParams(index: number): PatternParamNodes {
    return {
      rotationRadians: this.pattern_rotationRadians[index]!,
      density: this.pattern_density[index]!,
      grassJitterOffset: this.pattern_grassJitterOffset[index]!,
      grassBladeLength: this.pattern_grassBladeLength[index]!,
      grassBladeWidth: this.pattern_grassBladeWidth[index]!,
      grassBladeTaper: this.pattern_grassBladeTaper[index]!,
      grassBladeBend: this.pattern_grassBladeBend[index]!,
      grassBladeCurvature: this.pattern_grassBladeCurvature[index]!,
      grassClumpScale: this.pattern_grassClumpScale[index]!,
      grassClumpStrength: this.pattern_grassClumpStrength[index]!,
      grassDirectionality: this.pattern_grassDirectionality[index]!,
      grassDryness: this.pattern_grassDryness[index]!,
      grassTipFade: this.pattern_grassTipFade[index]!,
      grassRootDarkening: this.pattern_grassRootDarkening[index]!,
      grassHeightJitter: this.pattern_grassHeightJitter[index]!,
      grassWidthJitter: this.pattern_grassWidthJitter[index]!,
      grassLeanJitter: this.pattern_grassLeanJitter[index]!,
      grassEdgeWear: this.pattern_grassEdgeWear[index]!,
      turfFiberLength: this.pattern_turfFiberLength[index]!,
      turfFiberWidth: this.pattern_turfFiberWidth[index]!,
      turfFiberBreakup: this.pattern_turfFiberBreakup[index]!,
      turfFiberSoftness: this.pattern_turfFiberSoftness[index]!,
      pebbleJitterOffset: this.pattern_pebbleJitterOffset[index]!,
      pebbleJitterRotate: this.pattern_pebbleJitterRotate[index]!,
      pebbleRadiusScale: this.pattern_pebbleRadiusScale[index]!,
      pebbleXScale: this.pattern_pebbleXScale[index]!,
      pebbleWear: this.pattern_pebbleWear[index]!,
      fabricWidth: this.pattern_fabricWidth[index]!,
      fabricWidthUpper: this.pattern_fabricWidthUpper[index]!,
      aspectDivisor: this.pattern_aspectDivisor[index]!,
      offset: this.pattern_offset[index]!,
      cellJitterOffset: this.pattern_cellJitterOffset[index]!,
      cellInnerHalf: this.pattern_cellInnerHalf[index]!,
      cellRadius: this.pattern_cellRadius[index]!,
      cellWear: this.pattern_cellWear[index]!
    };
  }

  public readonly age = uniform(0);
  public readonly weathering = uniform(0);
  public readonly gravity = uniform(-1);
  public readonly macro = uniform(1);
  public readonly meso = uniform(1);
  public readonly micro = uniform(1);
  public readonly variation = uniform(0.35);
  public readonly stochasticTiling = uniform(0);

  public readonly baseRoughness = uniform(0.34);
  public readonly baseMetalness = uniform(0);
  public readonly baseClearcoat = uniform(0.34);
  public readonly baseClearcoatRoughness = uniform(0.18);
  public readonly normalStrength = uniform(PTL_SHADER_DEFAULTS.normalStrength);
  public readonly sssThicknessScale = uniform(PTL_SHADER_DEFAULTS.sssThicknessScale);

  public readonly sdfRadius = uniform(DEFAULT_MATERIAL_ALGORITHMS.sdf.radius);
  public readonly sdfBoxSize = uniform(DEFAULT_MATERIAL_ALGORITHMS.sdf.boxSize);
  public readonly sdfEdgeSoftness = uniform(DEFAULT_MATERIAL_ALGORITHMS.sdf.edgeSoftness);

  public sync(
    layers: readonly MaterialLayer[],
    groups: readonly MaterialGroup[],
    synthesis?: Readonly<SynthesisSettings>
  ): void {
    const groupById = new Map(groups.map((group) => [group.id, group]));
    for (let index = 0; index < PTL_MAX_LAYERS; index += 1) {
      const layer = layers[index];
      const active = layer !== undefined;
      this.enabled[index]!.value = active && layer.enabled ? 1 : 0;
      this.opacity[index]!.value = active ? layer.opacity : 0;
      this.scale[index]!.value = active ? layer.scale : 1;
      this.strength[index]!.value = active ? layer.strength : 1;
      this.seed[index]!.value = active ? layer.seed : 1;
      this.colorA[index]!.value.set(active ? layer.colorA : '#000000');
      this.colorB[index]!.value.set(active ? layer.colorB : '#000000');
      this.roughness[index]!.value = active ? layer.roughness : 0;
      this.displacement[index]!.value = active ? layer.displacement : 0;
      this.groupOpacity[index]!.value = active ? effectiveGroupOpacity(layer.groupId, groupById) : 1;
      this.maskInvert[index]!.value = active && layer.maskInvert ? 1 : 0;
      this.maskStrength[index]!.value = active ? layer.maskStrength : 1;

      const layerPattern = active ? layer.pattern : null;
      const patternParams = layerPattern === null || layerPattern === undefined
        ? DEFAULT_PATTERN_PARAMS
        : derivePatternParams(layerPattern);
      this.pattern_rotationRadians[index]!.value = patternParams.rotationRadians;
      this.pattern_density[index]!.value = patternParams.density;
      this.pattern_grassJitterOffset[index]!.value = patternParams.grassJitterOffset;
      this.pattern_grassBladeLength[index]!.value = patternParams.grassBladeLength;
      this.pattern_grassBladeWidth[index]!.value = patternParams.grassBladeWidth;
      this.pattern_grassBladeTaper[index]!.value = patternParams.grassBladeTaper;
      this.pattern_grassBladeBend[index]!.value = patternParams.grassBladeBend;
      this.pattern_grassBladeCurvature[index]!.value = patternParams.grassBladeCurvature;
      this.pattern_grassClumpScale[index]!.value = patternParams.grassClumpScale;
      this.pattern_grassClumpStrength[index]!.value = patternParams.grassClumpStrength;
      this.pattern_grassDirectionality[index]!.value = patternParams.grassDirectionality;
      this.pattern_grassDryness[index]!.value = patternParams.grassDryness;
      this.pattern_grassTipFade[index]!.value = patternParams.grassTipFade;
      this.pattern_grassRootDarkening[index]!.value = patternParams.grassRootDarkening;
      this.pattern_grassHeightJitter[index]!.value = patternParams.grassHeightJitter;
      this.pattern_grassWidthJitter[index]!.value = patternParams.grassWidthJitter;
      this.pattern_grassLeanJitter[index]!.value = patternParams.grassLeanJitter;
      this.pattern_grassEdgeWear[index]!.value = patternParams.grassEdgeWear;
      this.pattern_turfFiberLength[index]!.value = patternParams.turfFiberLength;
      this.pattern_turfFiberWidth[index]!.value = patternParams.turfFiberWidth;
      this.pattern_turfFiberBreakup[index]!.value = patternParams.turfFiberBreakup;
      this.pattern_turfFiberSoftness[index]!.value = patternParams.turfFiberSoftness;
      this.pattern_pebbleJitterOffset[index]!.value = patternParams.pebbleJitterOffset;
      this.pattern_pebbleJitterRotate[index]!.value = patternParams.pebbleJitterRotate;
      this.pattern_pebbleRadiusScale[index]!.value = patternParams.pebbleRadiusScale;
      this.pattern_pebbleXScale[index]!.value = patternParams.pebbleXScale;
      this.pattern_pebbleWear[index]!.value = patternParams.pebbleWear;
      this.pattern_fabricWidth[index]!.value = patternParams.fabricWidth;
      this.pattern_fabricWidthUpper[index]!.value = patternParams.fabricWidthUpper;
      this.pattern_aspectDivisor[index]!.value = patternParams.aspectDivisor;
      this.pattern_offset[index]!.value = patternParams.offset;
      this.pattern_cellJitterOffset[index]!.value = patternParams.cellJitterOffset;
      this.pattern_cellInnerHalf[index]!.value = patternParams.cellInnerHalf;
      this.pattern_cellRadius[index]!.value = patternParams.cellRadius;
      this.pattern_cellWear[index]!.value = patternParams.cellWear;
    }

    if (synthesis === undefined) return;
    this.age.value = synthesis.age;
    this.weathering.value = synthesis.weathering;
    this.gravity.value = synthesis.gravity;
    this.macro.value = synthesis.macro;
    this.meso.value = synthesis.meso;
    this.micro.value = synthesis.micro;
    this.variation.value = synthesis.variation;
    this.stochasticTiling.value = synthesis.stochasticTiling;
  }

  public setPhysical(settings: Readonly<PhysicalSettings>): void {
    this.baseRoughness.value = settings.roughness;
    this.baseMetalness.value = settings.metalness;
    this.baseClearcoat.value = settings.clearcoat;
    this.baseClearcoatRoughness.value = settings.clearcoatRoughness;
  }

  public setAlgorithms(settings: Readonly<MaterialAlgorithmSettings>): void {
    this.sdfRadius.value = settings.sdf.radius;
    this.sdfBoxSize.value = settings.sdf.boxSize;
    this.sdfEdgeSoftness.value = settings.sdf.edgeSoftness;
  }
}
