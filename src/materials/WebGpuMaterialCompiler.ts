import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  float,
  max,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalView,
  normalWorldGeometry,
  positionLocal,
  positionView,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import type { MaterialAlgorithmSettings } from '../core/material/MaterialAlgorithms';
import type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
import { PTL_MAX_LAYERS } from '../core/material/runtimeDefaults';
import { applyPhysicalSettings } from './PhysicalMaterial';
import {
  buildWebGpuSurfaceNodes,
  webGpuTopologyFingerprint,
  type WebGpuSimulationState
} from './WebGpuProceduralNodes';
import { WebGpuMaterialUniforms } from './WebGpuMaterialUniforms';
import type {
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  SynthesisSettings
} from './types';

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
  private coordinateSpace: MaterialCoordinateSpace = 'world';
  private simulation: WebGpuSimulationState = {
    texture: this.fallbackTexture,
    readyLayers: new Array<boolean>(PTL_MAX_LAYERS).fill(false),
    cellSize: 1
  };
  private topologyFingerprint = '';

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
    this.layers = layers.slice(0, PTL_MAX_LAYERS).map((layer) => ({ ...layer }));
    this.coordinateSpace = coordinateSpace;
    this.uniforms.sync(this.layers, groups, synthesis);

    if (this.material.wireframe !== wireframe) {
      this.material.wireframe = wireframe;
      this.material.needsUpdate = true;
    }
    this.rebuildIfNeeded();
  }

  public setPhysical(settings: Readonly<PhysicalSettings>): void {
    this.uniforms.setPhysical(settings);
    applyPhysicalSettings(this.material, settings);
  }

  public setAlgorithmSettings(settings: Readonly<MaterialAlgorithmSettings>): void {
    this.uniforms.setAlgorithms(settings);
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
      this.simulation.readyLayers
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
    const vertexSurface = buildWebGpuSurfaceNodes(
      vertexSample,
      this.layers,
      this.uniforms,
      this.simulation
    );

    this.material.positionNode = Fn(() => {
      samplePosition.assign(vertexSample);
      const worldOffset = normalWorldGeometry.mul(vertexSurface.displacement);
      const localOffset = modelWorldMatrixInverse.mul(vec4(worldOffset, 0)).xyz;
      return localPosition.add(localOffset);
    })();

    const surface = buildWebGpuSurfaceNodes(
      samplePosition,
      this.layers,
      this.uniforms,
      this.simulation
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

    const sigmaX = positionView.dFdx();
    const sigmaY = positionView.dFdy();
    const r1 = sigmaY.cross(normalView);
    const r2 = normalView.cross(sigmaX);
    const determinant = sigmaX.dot(r1);
    const safeDeterminant = max(abs(determinant), 0.00000001);
    const gradient = surface.displacement.dFdx().mul(r1)
      .add(surface.displacement.dFdy().mul(r2))
      .mul(determinant.sign());
    this.material.normalNode = safeDeterminant.mul(normalView)
      .sub(gradient.mul(this.uniforms.normalStrength))
      .normalize();

    this.material.thicknessColorNode = surface.sssColor.mul(surface.sss);
    this.material.thicknessDistortionNode = float(0.12);
    this.material.thicknessAmbientNode = float(0.35);
    this.material.thicknessAttenuationNode = float(0.8);
    this.material.thicknessPowerNode = float(2.2);
    this.material.thicknessScaleNode = surface.sss.mul(this.uniforms.sssThicknessScale).mul(16);
    this.material.needsUpdate = true;
  }
}
