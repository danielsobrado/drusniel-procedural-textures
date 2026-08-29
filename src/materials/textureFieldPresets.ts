import { TEXTURE_LIBRARY_ASSETS } from '../config/textureLibraryConfig';
import type { SurfaceGraphDefinition } from '../core/graph/SurfaceGraph';
import { compileSurfaceGraph } from './SurfaceGraphCompiler';
import type { MaterialPreset } from './types';

const FAMILY_COLOR_LOW = '#171a1d';
const FAMILY_COLOR_HIGH = '#d9dde1';

function title(value: string): string {
  return value
    .split('-')
    .map((part) => part.length === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function familyGraph(family: string, textureIds: readonly string[]): SurfaceGraphDefinition {
  const defaultTextureId = textureIds[0];
  if (defaultTextureId === undefined) throw new Error(`Texture family ${family} is empty.`);
  // A sibling variant decorrelates the roughness breakup from the field driving colour and
  // height. Single-variant families fall back to the same asset; the layers still diverge
  // because they carry different seeds, scales and rotations.
  const roughnessTextureId = textureIds[1] ?? defaultTextureId;

  return {
    version: 1,
    id: `texture-field-${family}`,
    name: `${title(family)} Texture Field`,
    nodes: [
      {
        id: 'field',
        kind: 'texture-field',
        label: `${title(family)} field`,
        position: { x: 80, y: 100 },
        params: {
          textureId: defaultTextureId,
          scale: 3,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          offsetX: 0,
          offsetY: 0,
          contrast: 1,
          bias: 0,
          invert: false,
          clamp: true,
          sampleChannel: 'r',
          mode: 'replace',
          modeAmount: 1,
          strength: 1,
          displacement: 0.025,
          colorA: FAMILY_COLOR_LOW,
          colorB: FAMILY_COLOR_HIGH
        }
      },
      {
        id: 'surface',
        // An fbm carrying the same family field in `detail` mode. The field stays the visible
        // subject of the preset on colour and height; here it only breaks up roughness, which is
        // what stops the family reading as a flat painted decal under a moving light.
        kind: 'noise',
        label: `${title(family)} roughness breakup`,
        position: { x: 80, y: 300 },
        params: {
          textureId: roughnessTextureId,
          mode: 'detail',
          modeAmount: 0.45,
          scale: 9,
          strength: 1,
          seed: 41,
          opacity: 0.55,
          roughness: 0.16,
          scaleX: 1.27,
          scaleY: 0.83,
          rotation: -0.41,
          contrast: 1.08,
          bias: 0,
          sampleChannel: 'r'
        }
      },
      {
        id: 'output',
        kind: 'output',
        label: 'Material Output',
        position: { x: 420, y: 100 },
        params: {}
      }
    ],
    edges: [
      {
        from: { nodeId: 'field', port: 'color' },
        to: { nodeId: 'output', port: 'baseColor' }
      },
      {
        from: { nodeId: 'field', port: 'height' },
        to: { nodeId: 'output', port: 'height' }
      },
      {
        from: { nodeId: 'surface', port: 'height' },
        to: { nodeId: 'output', port: 'roughness' }
      }
    ],
    outputs: [
      { channel: 'baseColor', source: { nodeId: 'field', port: 'color' } },
      { channel: 'height', source: { nodeId: 'field', port: 'height' } },
      { channel: 'roughness', source: { nodeId: 'surface', port: 'height' } }
    ],
    exposed: [
      {
        id: 'texture',
        label: 'Texture',
        nodeId: 'field',
        parameter: 'textureId',
        type: 'enum',
        defaultValue: defaultTextureId,
        options: [...textureIds]
      },
      {
        id: 'domain-scale',
        label: 'Domain scale',
        nodeId: 'field',
        parameter: 'scale',
        type: 'float',
        defaultValue: 3,
        min: 0.1,
        max: 20,
        step: 0.1
      },
      {
        id: 'scale-x',
        label: 'Texture scale X',
        nodeId: 'field',
        parameter: 'scaleX',
        type: 'float',
        defaultValue: 1,
        min: 0.1,
        max: 8,
        step: 0.05
      },
      {
        id: 'scale-y',
        label: 'Texture scale Y',
        nodeId: 'field',
        parameter: 'scaleY',
        type: 'float',
        defaultValue: 1,
        min: 0.1,
        max: 8,
        step: 0.05
      },
      {
        id: 'rotation',
        label: 'Rotation',
        nodeId: 'field',
        parameter: 'rotation',
        type: 'float',
        defaultValue: 0,
        min: -3.14159,
        max: 3.14159,
        step: 0.01
      },
      {
        id: 'contrast',
        label: 'Contrast',
        nodeId: 'field',
        parameter: 'contrast',
        type: 'float',
        defaultValue: 1,
        min: 0,
        max: 4,
        step: 0.05
      },
      {
        id: 'bias',
        label: 'Bias',
        nodeId: 'field',
        parameter: 'bias',
        type: 'float',
        defaultValue: 0,
        min: -1,
        max: 1,
        step: 0.01
      },
      {
        id: 'sample-channel',
        label: 'Sample channel',
        nodeId: 'field',
        parameter: 'sampleChannel',
        type: 'enum',
        defaultValue: 'r',
        options: ['r', 'g', 'b', 'a', 'luminance']
      },
      {
        id: 'mode',
        label: 'Field role',
        nodeId: 'field',
        parameter: 'mode',
        type: 'enum',
        defaultValue: 'replace',
        options: ['replace', 'modulate', 'warp', 'detail']
      },
      {
        id: 'mode-amount',
        label: 'Role amount',
        nodeId: 'field',
        parameter: 'modeAmount',
        type: 'float',
        defaultValue: 1,
        min: 0,
        max: 4,
        step: 0.01
      },
      {
        id: 'invert',
        label: 'Invert',
        nodeId: 'field',
        parameter: 'invert',
        type: 'boolean',
        defaultValue: false
      },
      {
        id: 'height',
        label: 'Height',
        nodeId: 'field',
        parameter: 'displacement',
        type: 'float',
        defaultValue: 0.025,
        min: 0,
        max: 0.12,
        step: 0.001
      },
      {
        id: 'low-color',
        label: 'Low color',
        nodeId: 'field',
        parameter: 'colorA',
        type: 'color',
        defaultValue: FAMILY_COLOR_LOW
      },
      {
        id: 'high-color',
        label: 'High color',
        nodeId: 'field',
        parameter: 'colorB',
        type: 'color',
        defaultValue: FAMILY_COLOR_HIGH
      },
      {
        id: 'roughness-texture',
        label: 'Roughness field',
        nodeId: 'surface',
        parameter: 'textureId',
        type: 'enum',
        defaultValue: roughnessTextureId,
        options: [...textureIds]
      },
      {
        id: 'roughness-scale',
        label: 'Roughness scale',
        nodeId: 'surface',
        parameter: 'scale',
        type: 'float',
        defaultValue: 9,
        min: 0.5,
        max: 20,
        step: 0.1
      },
      {
        id: 'roughness-detail',
        label: 'Roughness detail',
        nodeId: 'surface',
        parameter: 'modeAmount',
        type: 'float',
        defaultValue: 0.45,
        min: 0,
        max: 2,
        step: 0.01
      },
      {
        id: 'roughness-strength',
        label: 'Roughness variation',
        nodeId: 'surface',
        parameter: 'roughness',
        type: 'float',
        defaultValue: 0.16,
        min: -0.5,
        max: 0.5,
        step: 0.01
      }
    ],
    groups: [],
    subgraphs: []
  };
}

const BY_FAMILY = new Map<string, string[]>();
for (const asset of TEXTURE_LIBRARY_ASSETS) {
  const ids = BY_FAMILY.get(asset.family) ?? [];
  ids.push(asset.id);
  BY_FAMILY.set(asset.family, ids);
}

export const TEXTURE_FIELD_PRESETS: readonly MaterialPreset[] = [...BY_FAMILY.entries()].map(
  ([family, textureIds]) => {
    const graph = familyGraph(family, textureIds);
    const compiled = compileSurfaceGraph(graph);
    return {
      id: `texture-field-${family}`,
      name: `${title(family)} Fields`,
      description: `KTX2 ${title(family).toLowerCase()} fields for color, height, masking and shared surface structure.`,
      tags: ['texture-field', 'hybrid', family],
      physical: {
        roughness: 0.46,
        clearcoat: 0.08,
        clearcoatRoughness: 0.32
      },
      groups: compiled.groups,
      layers: compiled.layers,
      graph: compiled.graph
    };
  }
);
