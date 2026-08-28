import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/materials/WebGpuSurfaceDesignerNodes.ts', import.meta.url),
  'utf8'
);

describe('WebGPU designer channel routing', () => {
  it('routes designer SSS layers instead of dropping them from the WebGPU material', () => {
    expect(source).toContain('let sssColor = base.sssColor.mul(base.sss);');
    expect(source).toContain("if (layer.channel === 'sss')");
    expect(source).toContain('sssColor = sssColor.add(layerColor.mul(scatter));');
    expect(source).toContain('sss = sss.add(scatter);');
    expect(source).toContain('sssColor: sssColor.div(max(sss, 0.0001))');
  });

  it('routes procedural layers through texture-field mask and structure dependencies', () => {
    expect(source).toContain('function designerLayerIndices(');
    expect(source).toContain('const dependencies = [layer.maskSourceLayerId, layer.structureSourceLayerId];');
    expect(source).toContain('withoutDesignerLayers(activeLayers, designerIndices)');
    expect(source).toContain('if (!designerIndices.has(index)) return;');
    expect(source).toContain('const coverage = designerCoverage(layer, shaped, textureField);');
    expect(source).toContain('designerDisplacementSignal(layer, shaped, textureField)');
  });

  it('keeps designer roughness and clearcoat weighting aligned with the portable path', () => {
    expect(source).toContain("layer.kind === 'base' && !textureField");
    expect(source).toContain('mix(0.4, 1, shaped)');
    expect(source).toContain('opacity.mul(shaped).mul(max(uniforms.strength[index]!, 0))');
  });

  it('applies age and weathering after the complete hybrid surface', () => {
    expect(source).toContain('function withoutSynthesis(');
    expect(source).toContain("if (property === 'age' || property === 'weathering') return zero;");
    expect(source).toContain('const synthesisBase = buildLegacySurfaceNodes(position, [], neutralUniforms, simulation);');
    expect(source).toContain('const synthesis = buildLegacySurfaceNodes(position, [], uniforms, simulation);');
    expect(source).toContain('const synthesisRoughness = synthesis.roughness.sub(synthesisBase.roughness);');
    expect(source).toContain('const synthesisAo = synthesis.ao.div(max(synthesisBase.ao, 0.0001));');
    expect(source).toContain('color: color.mul(synthesisColor)');
    expect(source).toContain('roughness: roughness.add(synthesisRoughness)');
    expect(source).toContain('ao: ao.mul(synthesisAo)');
    expect(source).not.toContain('synthesis.color.div(vec3(0.42, 0.45, 0.50))');
  });

  it('rebuilds the WebGPU topology when designer dependencies change', () => {
    expect(source).toContain('maskSourceLayerId: layer.maskSourceLayerId');
    expect(source).toContain('structureSourceLayerId: layer.structureSourceLayerId');
  });

  it('uses normal-weighted seeded sampling and preserves the layer generator by mode', () => {
    expect(source).toContain('normalWorldGeometry');
    expect(source).toContain('const normal = triplanarNormal.normalize();');
    expect(source).toContain('buildWebGpuStochasticDomain(position, seedOffset, uniforms.stochasticTiling)');
    expect(source).toContain("if (textureSettings.mode === 'replace')");
    expect(source).toContain("textureSettings.mode === 'warp'");
    expect(source).toContain("textureSettings.mode === 'modulate'");
    expect(source).toContain("textureSettings.mode === 'detail'");
    expect(source).toContain("const textureField = layer.texture?.mode === 'replace';");
  });
});
