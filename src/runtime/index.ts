export {
  createMaterialRecipe,
  loadMaterialRecipe,
  parseMaterialRecipe,
  serializeMaterialRecipe,
  PTL_MATERIAL_FILE_SUFFIX,
  PTL_MATERIAL_FORMAT,
  PTL_MATERIAL_VERSION,
  type MaterialRecipe,
  type MaterialRecipeDependencies,
  type MaterialTextureDependency
} from './MaterialRecipe';
export {
  ProceduralMaterial,
  type ProceduralMaterialBackend,
  type ProceduralMaterialOptions,
  type TextureFieldSource
} from './ProceduralMaterial';
export {
  GeneratedTextureResolver,
  PTL_GENERATED_TEXTURE_FIELD_FAMILIES,
  PTL_GENERATED_TEXTURE_FIELD_VERSION,
  type GeneratedTextureResolverOptions
} from './GeneratedTextureResolver';
export type { TextureResolver } from './TextureResolver';
export type { ResolvedTextureField, TextureFieldResource } from '../core/texture/ResolvedTextureField';
export {
  PTL_ALGORITHM_VERSION,
  type MaterialAlgorithmSettings
} from '../core/material/MaterialAlgorithms';
export type { MaterialCoordinateSpace } from '../core/material/MaterialCoordinates';
export type { PatternKind, PatternSettings } from '../core/material/PatternSettings';
export {
  DEFAULT_TEXTURE_FIELD_SETTINGS,
  TEXTURE_FIELD_MODES,
  TEXTURE_FIELD_CHANNELS,
  type TextureFieldChannel,
  type TextureFieldMode,
  type TextureFieldSettings
} from '../core/texture/TextureFieldSettings';
export type {
  BlendMode,
  LayerChannel,
  LayerKind,
  MaterialGroup,
  MaterialLayer,
  PhysicalSettings,
  RuntimeMaterialDefinition,
  SynthesisSettings
} from '../core/material/RuntimeMaterial';
export { normalizeSurfaceGraph } from '../core/graph/SurfaceGraphValidation';
export {
  setSurfaceGraphExposedValue,
  type SurfaceGraphExposedValue
} from '../core/graph/SurfaceGraphParameters';
export {
  compileSurfaceGraph,
  type SurfaceGraphCompilation
} from '../materials/SurfaceGraphCompiler';
export type {
  SurfaceGraphDefinition,
  SurfaceGraphEdge,
  SurfaceGraphExposedParameter,
  SurfaceGraphNode,
  SurfaceGraphNodeKind,
  SurfaceGraphOutput,
  SurfaceGraphParameterValue,
  SurfaceGraphPortRef,
  SurfaceGraphRuntimeLayer,
  SurfaceGraphValueType
} from '../core/graph/SurfaceGraph';
