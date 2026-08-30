export type TerrainComputeBackend = 'webgpu' | 'cpu';

export type TerrainViewMode =
  | 'material'
  | 'height'
  | 'slope'
  | 'flow'
  | 'river'
  | 'wetness'
  | 'repeat';

export type TerrainBaseMaterialId = 'grass' | 'rock' | 'mud' | 'snow';
export type TerrainMaterialId = TerrainBaseMaterialId | 'current' | 'custom';
export type TerrainExternalMaterialId = Extract<TerrainMaterialId, 'current' | 'custom'>;

export interface TerrainSettings {
  seed: number;
  mountainCoverage: number;
  mountainHeight: number;
  ridgeSharpness: number;
  detail: number;
  riverDensity: number;
  riverDepth: number;
  wetnessRadius: number;
  materialRepeat: number;
  /**
   * Optional per-material override in metres per tile, falling back to `materialRepeat`.
   * Optional so `TerrainRecipe` stays version 1 and existing settings literals still compile.
   */
  materialScales?: Partial<Record<TerrainMaterialId, number>>;
}

export interface TerrainFields {
  resolution: number;
  height: Float32Array;
  slope: Float32Array;
  flow: Float32Array;
  river: Float32Array;
  wetness: Float32Array;
  material: Uint8Array;
  backend: TerrainComputeBackend;
}

export interface TerrainBrushStroke {
  material: TerrainMaterialId;
  x: number;
  y: number;
  radius: number;
  hardness: number;
  strength: number;
  erase: boolean;
}

export interface TerrainPaintMask {
  material: Uint8Array;
  weight: Float32Array;
}

export interface TerrainTextureSource {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export const TERRAIN_PBR_CHANNELS = [
  'albedo',
  'roughness',
  'normal',
  'height',
  'clearcoat',
  'clearcoatRoughness',
  'metallic',
  'ao',
  'emissive'
] as const;

export type TerrainPbrChannel = typeof TERRAIN_PBR_CHANNELS[number];

/** Complete baked material data. Imported single images intentionally provide albedo only. */
export interface TerrainPbrTextureSet {
  albedo: TerrainTextureSource;
  roughness?: TerrainTextureSource;
  normal?: TerrainTextureSource;
  height?: TerrainTextureSource;
  clearcoat?: TerrainTextureSource;
  clearcoatRoughness?: TerrainTextureSource;
  metallic?: TerrainTextureSource;
  ao?: TerrainTextureSource;
  emissive?: TerrainTextureSource;
}

export interface TerrainExternalMaterial {
  id: TerrainExternalMaterialId;
  source: 'current-ptl' | 'image';
  name: string | null;
}

export interface TerrainRecipe {
  version: 1;
  kind: 'ptl-terrain';
  tileable: true;
  resolution: number;
  worldSize: number;
  heightScale: number;
  settings: TerrainSettings;
  strokes: TerrainBrushStroke[];
  materialPresets: Partial<Record<TerrainBaseMaterialId, string>>;
  externalMaterials: TerrainExternalMaterial[];
}

export const TERRAIN_MATERIALS: ReadonlyArray<{
  id: TerrainMaterialId;
  label: string;
  index: number;
  color: readonly [number, number, number];
}> = [
  { id: 'grass', label: 'Grass', index: 0, color: [76, 103, 55] },
  { id: 'rock', label: 'Rock', index: 1, color: [104, 104, 98] },
  { id: 'mud', label: 'Mud', index: 2, color: [91, 72, 48] },
  { id: 'snow', label: 'Snow', index: 3, color: [218, 225, 226] },
  { id: 'current', label: 'Current PTL', index: 4, color: [111, 126, 104] },
  { id: 'custom', label: 'Imported', index: 5, color: [112, 96, 86] }
];

export function terrainMaterialIndex(id: TerrainMaterialId): number {
  return TERRAIN_MATERIALS.find((material) => material.id === id)?.index ?? 0;
}
