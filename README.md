# Procedural Texture Lab

A realtime Three.js material playground for building layered procedural surfaces, previewing them on 3D meshes, and exporting practical PBR assets.

**Live demo:** [danielsobrado.github.io/drusniel-procedural-textures](https://danielsobrado.github.io/drusniel-procedural-textures/)

**npm runtime library:** [PTL Runtime documentation](docs/runtime-package-README.md) : installation, Three.js integration, WebGPU/WebGL backends, recipes, self-contained or externally resolved texture fields, resolver ownership, versioning, testing, and manual npm publishing.

## V0.3.2 showcase

![Procedural Texture Lab V0.3.2 showcase](docs/images/v0-3-2-showcase.png)

## V0.3.0 

V0.3 turns the authored surface graph into a visual material-authoring workspace on top of the portable PTL runtime. Graph-backed materials keep their node structure, routing, exposed controls, and existing runtime-bound subgraph references while compiling through the same WebGPU-first preview, portable bake/export, and `.ptl.json` runtime representation.

The native TypeScript graph workspace uses HTML nodes and an SVG routing layer rather than introducing React or a second frontend architecture. It provides draggable nodes, pan/zoom and fit, a searchable node browser, typed sockets, live graph compilation, node parameters, exposed controls, duplication/deletion, undo/redo integration, PBR output routing, and a dedicated node inspector. Formal typed routes are solid and type-colored; legacy runtime `structureFrom` and `maskFrom` field relationships remain visible as lower-contrast dashed links until a formal route overrides the same runtime dependency slot.

The Surface Designer node catalog covers shape/scatter/flood-fill workflows, height filters, warps, transforms, blends, histogram and color utilities, normal/PBR conversion, SDFs, and PBR outputs. Existing runtime-bound subgraph nodes in shipped or imported graphs remain supported, but V0.3 does not create arbitrary unbound nested subgraphs because the runtime layer model cannot execute a generic nested graph interface yet. Graph validation rejects missing ports, incompatible connections, cycles, ambiguous driven inputs, invalid PBR output types, conflicting output routes, unsupported runtime input counts, and multiple material-output nodes before execution.

Native pattern layers support brick, tile, plank, grass blades, pebble scatter, roof tiles, and woven fabric with direct controls for aspect, gap, roundness, jitter, rotation, row offset, density, and edge wear. Graph-backed presets expose high-level parameters directly in the Inspector and recompile without flattening the authored graph.

Flagship V0.3 materials include old brick wall, dense grass, river gravel, clay roof tiles, weathered wood planks, ceramic tiles, woven fabric, weathered concrete, aged plaster, road asphalt, and cobblestone.

Static GLB displacement can optionally use bounded pre-displacement tessellation for finer geometric relief. It is disabled by default and configured in `config/surface-designer.yaml` with edge-length, iteration, and vertex-budget limits.

![Procedural Texture Lab V0.3.0 showcase](docs/images/v0-3-0-showcase.png)

## V0.2 

V0.2 builds coherent materials from shared structural fields instead of treating every PBR channel as an unrelated noise stack. It adds reaction-diffusion and erosion simulations, SDF structures, an advanced dependency graph, environmental ageing, multi-scale synthesis, continuous anti-repetition, a lockable six-variant material genome, and a procedural terrain workspace in Tile Lab.

The interactive material preview is WebGPU-first. Texture baking and GLB export use a dedicated WebGL renderer because the portable bake shaders target GLSL, while procedural compute uses WebGPU where implemented and bounded cooperative CPU fallbacks otherwise. Preview, portable runtime recipes, baking, and GLB export consume the same material and simulation fields. If neither WebGPU nor WebGL2 can initialize, the editor falls back to a usable no-preview state; project editing and portable recipe export remain available, while GPU-only operations report the missing capability.

![Procedural Texture Lab V0.2 showcase](docs/images/v0-2-showcase.png)

## V0.1 

![Procedural Texture Lab V0.1 showcase](docs/images/v0-1-showcase.png)

## What it does

- Builds materials from stackable noise, cells, ridges, spots, veins, vessels, wet-film, subsurface, reaction-diffusion, erosion, SDF, and native pattern layers
- Authors typed procedural surface graphs with exposed parameters and preserved runtime-bound subgraph references
- Supports masks, shared structure sources, groups, blend modes, displacement, and physical material controls
- Previews materials on built-in shapes or imported GLB/GLTF meshes
- Includes graph-backed architectural/surface materials plus stone, terrain, grass, moss, and biological presets
- Generates periodic mountainous terrain with drainage, rivers, wetness, automatic terrain material masks, wrapped material painting, 2D diagnostics, and an interactive 3D preview
- Imports repeating image textures into terrain paint slots and exports deterministic `.ptlmap.json` terrain recipes plus 16-bit R16 height data
- Bakes albedo, roughness, normal, height, clearcoat, clearcoat-roughness, metallic, AO, and emissive maps
- Exports portable GLB files with baked PBR textures and optional bounded micro-geometry for static displacement
- Exports small `.ptl.json` material recipes for runtime regeneration, including V0.3 surface graphs
- Saves and restores editor projects as JSON

The editor runs entirely in the browser. Imported models, terrain textures, and HDR files stay local and are never fetched from remote URLs.

## Run locally

```bash
npm ci
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

Preset thumbnails are static PNGs under `public/thumbnails/presets`. Generate only missing files after adding presets with:

```bash
npm run thumbnails:generate
```

Pass `-- --force` to rebuild the complete thumbnail cache.

## Controls

| Action          | Control                                      |
| --------------- | -------------------------------------------- |
| Orbit           | Left drag                                    |
| Pan             | Right drag                                   |
| Zoom            | Wheel or pinch                               |
| Frame selection | `F`                                        |
| Wireframe       | `W`                                        |
| Radial menu     | Right click,`Space`, or touch and hold     |
| Undo            | `Ctrl/Cmd + Z`                             |
| Redo            | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |

### Surface graph controls

| Action                                 | Control                                            |
| -------------------------------------- | -------------------------------------------------- |
| Pan graph                              | Drag empty canvas                                  |
| Zoom graph                             | Wheel                                              |
| Fit graph                              | `F` or **Fit**                             |
| Add node                               | **+ Node** or right click empty canvas       |
| Connect nodes                          | Drag an output socket to a compatible input socket |
| Disconnect input                       | Right click the input socket                       |
| Inspect node                           | Click node                                         |
| Duplicate node                         | `Ctrl/Cmd + D` or inspector action               |
| Delete node                            | `Delete` / `Backspace` or inspector action     |
| Cancel connection / close node browser | `Esc`                                            |
| Return to material preview             | **3D Preview**                               |

## Surface Designer

Choose a Surface Designer preset to load an authored graph. High-level graph parameters appear in the Inspector and remain connected to their graph nodes. Enable **Advanced graph** to open the full graph-authoring workspace in the viewport. The material continues to compile through the existing PTL runtime while editing; choose **3D Preview** to return to the rendered material without flattening the graph.

The graph workspace reads node and port definitions from the shared typed catalog. It does not maintain a second graph model. Connections are validated against the domain graph before state is committed, and graph edits participate in the normal project undo/redo history. Formal graph routes into runtime-bound nodes override the corresponding legacy runtime field dependency. The V0.3 runtime material model has two dependency slots per compiled node (`structure` and `mask`), so a graph edit that would require a third runtime dependency is rejected instead of being accepted as a no-op.

Selecting a native `Pattern sampler` layer exposes the low-level pattern controls. Editing a low-level layer or group intentionally detaches the authored graph because that edit may no longer be representable by its high-level graph. Editing the graph or one of its exposed parameters preserves and recompiles the graph.

Surface Designer configuration lives in `config/surface-designer.yaml`. The graph and pattern implementation is shared by WebGPU preview and portable baking/export paths rather than maintaining a separate preset-only renderer.

## Baking and export

Static meshes can receive generated atlas UVs when their source UVs are not safe to bake. Skinned and morph-target meshes keep their topology and need valid source UVs.

GLB export preserves the original hierarchy, transforms, animations, and untouched materials. Procedural layers are converted to standard PBR textures so the result works in regular glTF viewers. Biological subsurface scattering is approximated because glTF has no direct equivalent.

Simulation-backed layers are prepared before texture or GLB export so baked output matches the hydrated editor material instead of silently falling back to the analytic preview approximation.

When `microGeometry.enabled` is enabled in `config/surface-designer.yaml`, static displaced meshes are tessellated before the baked height map is applied. The exporter reduces tessellation automatically when needed to remain within the configured vertex budget and never mutates the source geometry.

## Tile Lab terrain

Tile Lab opens in terrain mode and generates a periodic world domain so mountain height, river fields, material masks, and manual paint wrap at tile boundaries. Diagnostic views expose height, slope, flow, rivers, wetness, and a repeated 3 × 3 map.

Manual terrain paint is recorded as normalized brush strokes instead of embedding a large raster mask. This keeps `.ptlmap.json` exports compact and resolution-independent. Imported image textures and the current PTL material are external dependencies; terrain recipes declare those dependencies instead of embedding their bytes.

Height export writes little-endian unsigned 16-bit `.r16` data together with an 8-bit PNG preview. The terrain recipe records world size and height scale so consumers can reconstruct the physical elevation range.

## Portable runtime materials

Use **Export PTL** to save the authored surface as a small, versioned `.ptl.json` recipe without project-only viewport or imported-asset state. V0.3 recipes can include the normalized surface graph and regenerate canonical PTL runtime layers. Version-1 and version-2 recipes remain supported and migrate in memory.

```ts
import {
  loadMaterialRecipe,
  ProceduralMaterial,
  setSurfaceGraphExposedValue,
  compileSurfaceGraph
} from '@drusniel/ptl-runtime';

const recipe = await loadMaterialRecipe('/materials/brick.ptl.json');
const procedural = new ProceduralMaterial(recipe, {
  coordinateSpace: 'object'
});

await procedural.prepare();
procedural.applyTo(mesh);

if (recipe.surfaceGraph) {
  const graph = setSurfaceGraphExposedValue(recipe.surfaceGraph, 'mortar-gap', 0.12);
  const compiled = compileSurfaceGraph(graph);
  console.log(compiled.layers);
}
```

Use `coordinateSpace: 'object'` for moving props so the pattern stays attached to the mesh. Use `world` for terrain and world-aligned surfaces. Recipes exported by the editor default to `world` to preserve existing authored output.

For deterministic variants of the same family, change the recipe seed and prepare again when simulation-backed layers are present:

```ts
procedural.setSeed(93771);
await procedural.prepare();
```

Call `procedural.dispose()` with the rest of the mesh resources.

The default runtime backend is the TSL node-material path for `WebGPURenderer`. Three.js can run that renderer through its WebGL2 backend when WebGPU is unavailable. Consumers using the classic `WebGLRenderer` must request `{ backend: 'webgl' }`; that compatibility adapter installs matching custom depth and distance materials.

Build and verify the staged npm tarball through a clean external TypeScript consumer with:

```bash
npm run test:runtime-package
```

The root Lab package remains private. `npm run build:runtime-package` stages only runtime JavaScript, declarations, package documentation, and the Apache-2.0 license under `dist-runtime-package/`; Three.js remains external and is declared as a peer dependency. Runtime publication is manual and independent from GitHub Pages:

```bash
npm run publish:runtime
```

Runtime publication is enabled in `config/runtime-package.yaml` under Apache-2.0. Publishing still happens only when `npm run publish:runtime` is invoked manually. Texture-bearing recipes work with no asset installation through deterministic generated fields included as runtime code. For exact Lab fidelity, the Apache-2.0 KTX2 catalog can be hosted separately and returned through `TextureResolver.resolve()`; the runtime selects a supplied resolver automatically.

The texture catalog is version 2: 117 stable field IDs are stored in 41 RGBA-packed, mipmapped UASTC/Zstd KTX2 files. Referenced packs are 1024², long-tail packs are 512², and the complete encoded library is capped at 48 MiB. See [Texture library](docs/texture-library.md) for generation and provenance.

## Development and release validation

```bash
npm run test:unit
npm run test:browser
npm run test:runtime-package
npm run test:production-export
npm run test:cross-browser
npm run test:qa
```

For the same validation gate used before a V0.3 release:

```bash
npm run release:check
```

`npm run ci` validates release metadata, strict unit tests, the production TypeScript/Vite build, browser smoke, renderer fallback, the staged runtime package, and a clean external TypeScript runtime consumer. `npm run release:check` additionally runs production export and cross-browser smoke.

The project uses TypeScript, Three.js, Vite, Vitest, and Playwright. Editor configuration lives in `config/`; portable material constraints, recipe algorithms, the material compiler, renderer, baker, exporter, terrain systems, and UI live under `src/`.

CI runs on pushes and pull requests to `main` and can also be started manually from GitHub Actions. GitHub Pages publishing remains manual:

```bash
npm run deploy
```

The npm runtime is also published manually:

```bash
npm run publish:runtime
```
