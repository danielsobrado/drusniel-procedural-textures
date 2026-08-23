export {
  createMaterialRecipe,
  loadMaterialRecipe,
  parseMaterialRecipe,
  serializeMaterialRecipe,
  PTL_MATERIAL_FILE_SUFFIX,
  PTL_MATERIAL_FORMAT,
  PTL_MATERIAL_VERSION,
  type MaterialRecipe
} from './MaterialRecipe';
export {
  ProceduralMaterial,
  type ProceduralMaterialOptions
} from './ProceduralMaterial';
export {
  DEFAULT_MATERIAL_ALGORITHMS,
  PTL_ALGORITHM_VERSION,
  normalizeMaterialAlgorithms,
  type MaterialAlgorithmSettings,
  type ReactionDiffusionAlgorithm,
  type SdfAlgorithm,
  type ThermalErosionAlgorithm
} from '../core/material/MaterialAlgorithms';
export {
  normalizeMaterialCoordinateSpace,
  type MaterialCoordinateSpace
} from '../core/material/MaterialCoordinates';
export {
  DEFAULT_PATTERN_SETTINGS,
  PATTERN_LIMITS,
  normalizePatternSettings,
  type PatternKind,
  type PatternSettings
} from '../core/material/PatternSettings';
export {
  SURFACE_GRAPH_NODE_SPECS,
  SURFACE_GRAPH_NODE_SPEC_BY_KIND,
  type SurfaceGraphNodeCategory,
  type SurfaceGraphNodeSpec,
  type SurfaceGraphPortSpec
} from '../core/graph/SurfaceGraphCatalog';
export { normalizeSurfaceGraph } from '../core/graph/SurfaceGraphValidation';
export {
  setSurfaceGraphExposedValue,
  surfaceGraphExposedValue,
  type SurfaceGraphExposedValue
} from '../core/graph/SurfaceGraphParameters';
export { lowerSurfaceGraphRuntimeNodes } from '../core/graph/SurfaceGraphRuntimeLowering';
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
