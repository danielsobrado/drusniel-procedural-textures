import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  float,
  max,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalLocal,
  normalView,
  normalWorldGeometry,
  positionLocal,
  positionView,
  sqrt,
  step,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import type { MaterialAlgorithmSettings } from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { materialDisplacementExtent } from '../core/material/MaterialDisplacement';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import { RUNTIME_RENDERER_SAFETY_CONFIG as rendererSafetyConfig } from '../core/material/generated/runtimeConfig';
import {
  normalizeResolvedTextureField,
  type ResolvedTextureField,
  type TextureFieldResource
} from '../core/texture/ResolvedTextureField';
import { applyPhysicalSettings } from './PhysicalMaterial';
import {
  buildWebGpuSurfaceNodes,
  webGpuTopologyFingerprint,
  type WebGpuSimulationState
} from './WebGpuSurfaceDesignerNodes';
import { WebGpuMaterialUniforms } from './WebGpuMaterialUniforms';
import type {
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';

function createFallbackTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([0]),
    1,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  texture.name = 'PTL Empty Simulation Atlas';
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function softLimitDisplacement(displacement: Node<'float'>, limitValue: number): Node<'float'> {
  const limit = float(limitValue);
  const scaled = displacement.div(limit);
  return displacement.div(sqrt(float(1).add(scaled.mul(scaled))));
}

export class WebGpuMaterialCompiler {
  public readonly material = new THREE.MeshSSSNodeMaterial({
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.18,
    specularIntensity: 0.62,
    ior: 1.42
  });

  private readonly uniforms = new WebGpuMaterialUniforms();
  private readonly fallbackTexture = createFallbackTexture();
  private layers: MaterialLayer[] = [];
  private textureFields: ReadonlyMap<string, ResolvedTextureField> = new Map();
  private coordinateSpace: MaterialCoordinateSpace = 'world';
  private simulation: WebGpuSimulationState = {
    texture: this.fallbackTexture,
    readyLayers: new Array<boolean>(PTL_MAX_LAYERS).fill(false),
    cellSize: 1
  };
  private topologyFingerprint = '';
  private displacementExtentValue = 0;

  public constructor() {
    this.material.name = 'Procedural Texture Lab WebGPU';
    this.rebuild();
  }

  public sync(
    layers: readonly MaterialLayer[],
    groups: readonly MaterialGroup[],
    wireframe: boolean,
    synthesis?: Readonly<SynthesisSettings>,
    coordinateSpace: MaterialCoordinateSpace = 'world'
  ): void {
    this.layers = layers.slice(0, PTL_MAX_LAYERS).map((layer) => ({
      ...layer,
      pattern: layer.pattern === undefined || layer.pattern === null ? layer.pattern : { ...layer.pattern },
      texture: layer.texture === undefined || layer.texture === null ? layer.texture : { ...layer.texture }
    }));
    this.displacementExtentValue = materialDisplacementExtent(this.layers, groups);
    this.coordinateSpace = coordinateSpace;
    this.uniforms.sync(this.layers, groups, synthesis);

    if (this.material.wireframe !== wireframe) {
      this.material.wireframe = wireframe;
      this.material.needsUpdate = true;
    }
    this.rebuildIfNeeded();
  }

  public get displacementExtent(): number {
    return this.displacementExtentValue;
  }

  public setPhysical(settings: Readonly<PhysicalSettings>): void {
    this.uniforms.setPhysical(settings);
    applyPhysicalSettings(this.material, settings);
  }

  public setAlgorithmSettings(settings: Readonly<MaterialAlgorithmSettings>): void {
    this.uniforms.setAlgorithms(settings);
  }

  public setTextureFields(textures: ReadonlyMap<string, TextureFieldResource>): void {
    this.textureFields = new Map(
      [...textures].map(([id, resource]) => [id, normalizeResolvedTextureField(resource)] as const)
    );
    this.rebuildIfNeeded();
  }

  public setSimulationAtlas(
    texture: THREE.Texture | null,
    readyLayers: readonly boolean[] = [],
    cellSize = 1
  ): void {
    this.simulation = {
      texture: texture ?? this.fallbackTexture,
      readyLayers: Array.from(
        { length: PTL_MAX_LAYERS },
        (_, index) => readyLayers[index] === true
      ),
      cellSize: Math.max(1, cellSize)
    };
    this.rebuildIfNeeded();
  }

  public dispose(): void {
    this.material.dispose();
    this.fallbackTexture.dispose();
  }

  private rebuildIfNeeded(): void {
    const fingerprint = `${webGpuTopologyFingerprint(
      this.layers,
      this.coordinateSpace,
      this.simulation.readyLayers,
      this.textureFields
    )}:${this.simulation.texture.uuid}:${this.simulation.cellSize}`;
    if (fingerprint === this.topologyFingerprint) return;
    this.topologyFingerprint = fingerprint;
    this.rebuild();
  }

  private rebuild(): void {
    const samplePosition = varying(vec3(), 'ptlSamplePosition');
    const localPosition = positionLocal;
    const worldPosition = modelWorldMatrix.mul(vec4(localPosition, 1)).xyz;
    const vertexSample = this.coordinateSpace === 'object' ? localPosition : worldPosition;
    const triplanarNormal = this.coordinateSpace === 'object' ? normalLocal : normalWorldGeometry;
    const vertexSurface = buildWebGpuSurfaceNodes(
      vertexSample,
      this.layers,
      this.uniforms,
      this.simulation,
      this.textureFields,
      triplanarNormal
    );

    this.material.positionNode = Fn(() => {
      samplePosition.assign(vertexSample);
      const displacement = softLimitDisplacement(
        vertexSurface.displacement,
        rendererSafetyConfig.displacement.geometrySoftLimit
      );
      const worldOffset = normalWorldGeometry.mul(displacement);
      const localOffset = modelWorldMatrixInverse.mul(vec4(worldOffset, 0)).xyz;
      return localPosition.add(localOffset);
    })();

    const surface = buildWebGpuSurfaceNodes(
      samplePosition,
      this.layers,
      this.uniforms,
      this.simulation,
      this.textureFields,
      triplanarNormal
    );
    this.material.colorNode = surface.color;
    this.material.roughnessNode = clamp(this.uniforms.baseRoughness.add(surface.roughness), 0.045, 1);
    this.material.metalnessNode = clamp(this.uniforms.baseMetalness.add(surface.metallic), 0, 1);
    this.material.clearcoatNode = max(this.uniforms.baseClearcoat, surface.clearcoat);
    this.material.clearcoatRoughnessNode = clamp(
      mix(this.uniforms.baseClearcoatRoughness, surface.clearcoatRoughness, surface.clearcoat),
      0.02,
      1
    );
    this.material.aoNode = surface.ao;
    this.material.emissiveNode = surface.emissive;

    const safeDisplacement = softLimitDisplacement(
      surface.displacement,
      rendererSafetyConfig.displacement.normalSoftLimit
    );
    const sigmaX = positionView.dFdx();
    const sigmaY = positionView.dFdy();
    const r1 = sigmaY.cross(normalView);
    const r2 = normalView.cross(sigmaX);
    const determinant = sigmaX.dot(r1);
    const determinantMagnitude = abs(determinant);
    const safeDeterminant = max(
      determinantMagnitude,
      float(rendererSafetyConfig.normal.determinantEpsilon)
    );
    const gradient = safeDisplacement.dFdx().mul(r1)
      .add(safeDisplacement.dFdy().mul(r2))
      .mul(determinant.sign());
    const normalCandidate = safeDeterminant.mul(normalView)
      .sub(gradient.mul(this.uniforms.normalStrength));
    const candidateLength = normalCandidate.length();
    const safeNormal = normalCandidate.div(max(
      candidateLength,
      float(rendererSafetyConfig.normal.vectorEpsilon)
    ));
    const validNormal = step(
      float(rendererSafetyConfig.normal.determinantEpsilon),
      determinantMagnitude
    ).mul(step(
      float(rendererSafetyConfig.normal.vectorEpsilon),
      candidateLength
    ));
    this.material.normalNode = mix(normalView, safeNormal, validNormal);

    this.material.thicknessColorNode = surface.sssColor.mul(surface.sss);
    this.material.thicknessDistortionNode = float(0.12);
    this.material.thicknessAmbientNode = float(0.35);
    this.material.thicknessAttenuationNode = float(0.8);
    this.material.thicknessPowerNode = float(2.2);
    this.material.thicknessScaleNode = surface.sss.mul(this.uniforms.sssThicknessScale).mul(16);
    this.material.needsUpdate = true;
  }
}
