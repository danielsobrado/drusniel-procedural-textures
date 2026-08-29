# Surface Designer v0.3

Procedural Texture Lab v0.3 adds an authored surface-graph layer over the existing portable PTL runtime. The renderer remains WebGPU-first, while portable GLSL remains available for baking and compatibility.

## Architecture

The Surface Designer is split into four small layers:

1. `src/core/graph/` defines and validates authored graphs, exposed parameters, reusable subgraphs, and generic node lowering.
2. `src/materials/SurfaceGraphCompiler.ts` lowers graph nodes into the established PTL material-layer runtime.
3. `src/materials/WebGpuSurfaceDesignerNodes.ts` and the portable GLSL path render the compiled pattern/material layers.
4. `.ptl.json` v2 stores the graph and regenerates canonical runtime layers on load.

Explicit runtime bindings on authored nodes are authoritative. Generic graph nodes without explicit bindings use the catalog lowering rules, so every supported node family has an executable runtime path without changing the visual behavior of hand-authored flagship materials.

## Node families

The catalog includes:

- Shape, noise, Tile Sampler and Shape Splatter
- Flood Fill, random color, gradient, position and index derivatives
- Bevel, slope blur, blur, non-uniform blur, distance, edge detect, curvature, emboss and sharpen
- Height blend/select
- Warp, directional/vector/multi-direction warp, swirl and slope warp
- Levels, histogram scan/range, clamp, contrast, posterize, quantize and invert
- Transform, mirror, symmetry, tile and polar transform
- Blend, min/max, multiply, add/subtract, overlay and screen
- Height-to-normal, curvature, AO, slope, edge and cavity
- Normal combine/blend/rotate
- RGB/HSL utilities and color variation
- SDF and reusable subgraphs
- PBR output routing

## Native patterns

The `pattern` material generator supports:

- brick
- tile
- plank
- grass blades
- pebble scatter
- roof tile
- woven fabric

Pattern controls include aspect, gap, roundness, jitter, rotation, row offset, density and edge wear. They are implemented in both the WebGPU/TSL and portable GLSL paths.

## Graph editing

Graph-backed presets keep their authored graph in project state. The Inspector exposes graph parameters directly and recompiles the graph without flattening it. Direct low-level layer/group edits intentionally detach the graph because those edits may no longer be representable by the authored graph.

The Advanced Graph view shows authored node categories, runtime lowering, ports, routes and reusable subgraphs. Non-graph materials continue to use the legacy compiled layer graph view.

## Flagship graph materials

v0.3 includes graph-backed material families for:

- old brick wall
- dense grass
- river gravel
- clay roof tiles
- weathered wood planks
- ceramic tiles
- woven fabric
- weathered concrete
- aged plaster
- road asphalt
- cobblestone
- mossy brick wall

## Height masking

A material layer's mask source is shaped in one of two modes. `coverage`, the default,
consumes the source generator's field linearly and is what every pre-existing material uses.
`height` thresholds the source's relief instead, so the masked layer settles into the
source's crevices: moss in mortar joints, dirt in panel seams, snow on ledges.

Height mode adds three controls beside the existing mask strength and invert:

- `maskThreshold` — the relief level the blend centers on
- `maskSoftness` — the transition width around it
- `maskBreakup` — noise added to relief before thresholding, so the boundary is not a clean
  iso-line of the source

Relief is normalized to 0..1 with high meaning raised geometry, for every layer kind and
either displacement sign. The base signal is the shaped field; coverage folds in only for
kinds where it means absence of material rather than tint weight; and only a negative
displacement mirrors the result. `src/core/material/MaterialRelief.ts` holds that convention
as the reference the three evaluators are written against.

The `height-blend` node binds its `base` and `top` inputs by port name rather than through the
two-slot structure/mask router, which would read them in the reverse order. Its `opacity` port
cannot be driven, because the runtime layer carries a single mask slot already bound to `base`.

## Portable runtime

PTL material recipes use format version 2 when authored graph data is present. Version-1 recipes remain loadable and are migrated in memory. A recipe carrying a height-masked layer requires version 4, since an older runtime would render it as a coverage mask rather than fail. Runtime consumers can use the normalized graph and generated runtime layers without editor state.

## Optional export micro-geometry

Static GLB displacement can optionally tessellate geometry before applying the baked height map. This is controlled by `config/surface-designer.yaml` and is disabled by default.

The tessellation path has three safety controls:

- maximum edge length
- maximum tessellation iterations
- maximum exported vertex budget

If a requested tessellation level would exceed the budget, the exporter reduces the level and ultimately falls back to the source topology. Source geometry is never mutated.

## Configuration

Surface Designer UI catalogs, graph display limits and micro-geometry defaults live in `config/surface-designer.yaml`. Renderer/material behavior remains source-controlled; product tuning values are not scattered through UI code.

## Validation

Regression coverage includes:

- graph normalization and cycle rejection
- all catalog node kinds lowering to executable PTL material layers
- relief normalization across every layer kind and displacement sign
- height mask shaping, and its parity across the base GLSL, portable GLSL and TSL paths
- height blend port binding by name, including rejection of a driven opacity port
- portable shader patch integrity, so a stale search string fails instead of silently no-op
- graph routing
- exposed parameter editing without graph detachment
- pattern runtime serialization
- recipe v1 migration and v2 graph round-trips
- bounded micro-geometry tessellation
- existing material, Tile Lab, export and runtime-package suites
