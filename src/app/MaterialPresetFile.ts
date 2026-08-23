import { normalizeSurfaceGraph } from '../core/graph/SurfaceGraphValidation';
import { compileSurfaceGraph } from '../materials/SurfaceGraphCompiler';
import type { MaterialPreset, ProjectState } from '../materials/types';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_ENVIRONMENT,
  DEFAULT_OBJECT,
  DEFAULT_PHYSICAL,
  DEFAULT_SYNTHESIS
} from './constants';
import { normalizeProject } from './ProjectFile';

export const MATERIAL_PRESET_FILE_FORMAT = 'procedural-texture-lab-material-preset';
export const MATERIAL_PRESET_FILE_VERSION = 1;
export const MATERIAL_PRESET_NAME_MAX_LENGTH = 120;

interface MaterialPresetFile {
  format: typeof MATERIAL_PRESET_FILE_FORMAT;
  version: typeof MATERIAL_PRESET_FILE_VERSION;
  name: string;
  material: {
    physical: ProjectState['physical'];
    synthesis?: ProjectState['synthesis'];
    groups: ProjectState['groups'];
    layers: ProjectState['layers'];
    graph?: ProjectState['surfaceGraph'];
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function normalizePresetName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Material preset name must be a string.');
  }
  const name = value.trim();
  if (name.length === 0 || name.length > MATERIAL_PRESET_NAME_MAX_LENGTH) {
    throw new Error(`Material preset name must contain 1 to ${MATERIAL_PRESET_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

export function serializeMaterialPresetFile(state: Readonly<ProjectState>, name: string): string {
  const file: MaterialPresetFile = {
    format: MATERIAL_PRESET_FILE_FORMAT,
    version: MATERIAL_PRESET_FILE_VERSION,
    name: normalizePresetName(name),
    material: {
      physical: structuredClone(state.physical),
      synthesis: structuredClone(state.synthesis),
      groups: structuredClone(state.groups),
      layers: structuredClone(state.layers),
      graph: structuredClone(state.surfaceGraph ?? null)
    }
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseMaterialPresetFile(value: unknown): MaterialPreset {
  const file = asRecord(value, 'Material preset file');
  if (file.format !== MATERIAL_PRESET_FILE_FORMAT) {
    throw new Error('File is not a Procedural Texture Lab material preset.');
  }
  if (file.version !== MATERIAL_PRESET_FILE_VERSION) {
    throw new Error(`Unsupported material preset version: ${String(file.version)}.`);
  }

  const name = normalizePresetName(file.name);
  const material = asRecord(file.material, 'Material preset');
  const surfaceGraph = material.graph === null || material.graph === undefined
    ? null
    : normalizeSurfaceGraph(material.graph);
  const graphCompilation = surfaceGraph === null ? null : compileSurfaceGraph(surfaceGraph);
  const normalized = normalizeProject({
    version: 2,
    selectedObject: DEFAULT_OBJECT,
    selectedLayerId: null,
    importedAssetName: null,
    importedMeshes: [],
    selectedMeshId: null,
    meshAssignments: {},
    environment: DEFAULT_ENVIRONMENT,
    environmentAssetName: null,
    background: DEFAULT_BACKGROUND,
    wireframe: false,
    physical: material.physical ?? DEFAULT_PHYSICAL,
    synthesis: material.synthesis ?? DEFAULT_SYNTHESIS,
    surfaceGraph: graphCompilation?.graph ?? null,
    groups: graphCompilation?.groups ?? material.groups ?? [],
    layers: graphCompilation?.layers ?? material.layers
  });

  return {
    id: 'shared-material-preset',
    name,
    description: 'Shared Procedural Texture Lab material preset.',
    tags: ['shared', 'custom'],
    physical: normalized.physical,
    synthesis: normalized.synthesis,
    groups: normalized.groups,
    layers: normalized.layers,
    ...(normalized.surfaceGraph === null || normalized.surfaceGraph === undefined
      ? {}
      : { graph: normalized.surfaceGraph })
  };
}
