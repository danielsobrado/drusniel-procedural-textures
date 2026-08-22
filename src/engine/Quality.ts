export type FixedQualityTier = 'mobile' | 'balanced' | 'high' | 'ultra';
export type QualityTier = 'auto' | FixedQualityTier;

export interface QualityTierSettings {
  label: string;
  maxPixelRatio: number;
  shadowMapSize: number;
  bakeResolution: number;
  maxExportTextureSize: number;
}

export interface PerformanceStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  requestedTier: QualityTier;
  activeTier: FixedQualityTier;
}
