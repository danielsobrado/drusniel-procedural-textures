import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_ALGORITHMS } from '../src/core/material/MaterialAlgorithms';
import {
  requiredMaterialFieldLayerIndices,
  requiredTextureFieldIds
} from '../src/core/material/MaterialFieldDependencies';
import { DEFAULT_TEXTURE_FIELD_SETTINGS } from '../src/core/texture/TextureFieldSettings';
import {
  materialRequiresSimulation,
  materialSimulationFingerprint
} from '../src/engine/SimulationAtlas';
import { createPresetLayer } from '../src/materials/presetLayer';

describe('material field dependencies', () => {
  it('keeps disabled field sources required by enabled layers', () => {
    const textureSource = createPresetLayer('texture-source', 'Texture source', 'fbm', {
      enabled: false,
      texture: { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'organic.02' }
    });
    const simulationSource = createPresetLayer(
      'simulation-source',
      'Simulation source',
      'reaction-diffusion',
      {
        enabled: false,
        structureSourceLayerId: textureSource.id
      }
    );
    const visibleLayer = createPresetLayer('visible', 'Visible layer', 'fbm', {
      maskSourceLayerId: textureSource.id,
      structureSourceLayerId: simulationSource.id
    });
    const unusedTexture = createPresetLayer('unused', 'Unused texture', 'fbm', {
      enabled: false,
      texture: { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'grainy.03' }
    });
    const layers = [textureSource, simulationSource, visibleLayer, unusedTexture];

    expect([...requiredMaterialFieldLayerIndices(layers)].sort((left, right) => left - right))
      .toEqual([0, 1, 2]);
    expect(requiredTextureFieldIds(layers)).toEqual(['organic.02']);
    expect(materialRequiresSimulation(layers)).toBe(true);

    const fingerprint = JSON.parse(
      materialSimulationFingerprint(layers, DEFAULT_MATERIAL_ALGORITHMS)
    ) as { inputs: Array<{ index: number; kind: string }> };
    expect(fingerprint.inputs).toEqual([
      { index: 1, kind: 'reaction-diffusion', seed: simulationSource.seed }
    ]);
  });

  it('ignores disabled fields that are not part of an enabled dependency chain', () => {
    const hidden = createPresetLayer('hidden', 'Hidden', 'erosion', {
      enabled: false,
      texture: { ...DEFAULT_TEXTURE_FIELD_SETTINGS, id: 'rock.01' }
    });

    expect([...requiredMaterialFieldLayerIndices([hidden])]).toEqual([]);
    expect(requiredTextureFieldIds([hidden])).toEqual([]);
    expect(materialRequiresSimulation([hidden])).toBe(false);
  });
});
