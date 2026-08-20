# Procedural Texture Lab

A realtime Three.js material laboratory for building layered procedural surfaces, previewing them on procedural or imported meshes, baking production texture maps and exporting reusable GLB assets.

## Current features

### Procedural authoring

- Layered procedural material stack with live physical rendering
- Base, FBM, cellular, ridges, spots, veins, gradient, branching vessels, wet-film and subsurface-tissue generators
- Normal, multiply, add, screen and overlay blending
- Per-layer output routing to surface, color, roughness, height, clearcoat/wetness or SSS
- Layer masks sourced from another procedural layer with strength and inversion
- Nested material groups with enable/opacity inheritance
- Per-layer color, opacity, scale, strength, seed, roughness and displacement
- World-space displacement that remains normal-directed under non-uniform or mirrored object transforms
- Smooth displacement-aware shading reconstructed from the interpolated height slope rather than triangle face normals
- Matching depth/distance displacement for shadows

### Biological material depth

- Branching multi-frequency vessel generator
- Dedicated subsurface-tissue channel with realtime view-dependent scattering approximation
- Procedural wet-film layer driving per-pixel clearcoat and coat roughness
- Adipose SSS preset combining deep fat, lobules, fascia, vessels, subsurface depth and wet membrane

### Physical rendering

- Global roughness, metalness, clearcoat, clearcoat roughness, specular intensity and IOR
- Sheen, transmission, thickness and volumetric attenuation color/distance
- ACES filmic tone mapping and PMREM reflections
- Neutral, warm, cool and night studio environments
- Custom Radiance `.hdr` environment import

### Geometry and imported assets

- Sphere, icosphere, cube, rounded cube, torus and plane preview targets
- GLB, self-contained GLTF and multi-file GLTF bundles
- Multi-file GLTF resources are resolved only from the explicitly selected local bundle; remote resource URIs are rejected
- Relative GLTF bundle URIs are resolved from the primary GLTF directory before basename fallback, including parent-directory segments
- Encoded filename characters are preserved while URI query/fragment suffixes are handled separately
- Automatic model normalization, missing-normal generation, stale-operation cancellation and GPU cleanup
- Preview normalization is editor-only; GLB export preserves the imported source hierarchy, origin, scale and transforms
- Imported animation clips are retained for baked GLB export
- Imported scenes expose individual mesh targets
- Click a mesh in the viewport or choose it in the inspector
- Apply/remove the lab material per imported mesh while preserving its original material
- Selected-mesh framing and viewport outline

### Phase 3 production export

- UV-space GPU baking for albedo, roughness, tangent-space normal, height, clearcoat and clearcoat-roughness maps
- Morph/skinning-aware bake geometry using the current deformed vertex positions
- Configurable texture-island dilation to reduce seam bleeding
- Imported meshes require finite, non-degenerate, unique, non-overlapping UVs inside the 0–1 range; unsupported tiled/mirrored UV layouts fail explicitly
- UV overlap validation uses exact triangle intersection checks after spatial broad-phase filtering instead of texture-resolution sampling
- Procedural preview meshes can generate a deterministic triangle UV atlas when their built-in UVs are not bake-safe; GLB export carries that atlas geometry with the baked maps
- Quality-tier-controlled bake resolution and GLB texture limits
- Binary GLB export using baked standard PBR textures
- Full GLB export state is snapshotted before asynchronous baking so multi-mesh exports cannot mix edits made midway through an export
- Bake/export commands are serialized in the editor to avoid duplicate high-cost production jobs
- Individual bake contexts use isolated scenes so asynchronous PNG encoding cannot contaminate another bake
- Per-mesh GLB export preserves original materials on imported meshes that are not assigned to the lab material
- Imported ImageBitmap-backed textures are snapshotted before export so replacing the preview cannot invalidate an in-flight GLB
- Imported animation clips are exported against the cloned source hierarchy without the editor preview transform
- Realtime SSS is approximated conservatively in baked albedo because standard glTF has no direct SSS material model
- Embedded texture export through Three.js `GLTFExporter`
- Tagged preset browser with text/tag filtering
- GPU-rendered material preset thumbnails instead of static placeholder swatches
- Realtime FPS, frame-time, draw-call, triangle, geometry and texture profiling
- Auto, Mobile, Balanced, High and Ultra quality modes
- Two-ring radial menu with direct Bake and GLB export actions

### Editor workflow

- Compact responsive desktop/tablet/mobile layout
- Context radial menu on right click, `Space`, or touch long press
- Touch long-press radial activation is isolated from viewport picking/orbit gestures once triggered
- Drag-and-drop layer ordering plus touch-friendly move controls
- Material preset library with search, tags and rendered thumbnails
- Coalesced undo/redo for continuous edits
- Wireframe preview and PNG capture
- Project JSON import/export and localStorage autosave
- Version-1 project migration to the current version-2 format
- Validated YAML configuration for limits, controls, catalogs, environments, export policy and quality tiers

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Browser/WebGL production smoke:

```bash
npm run test:browser
```

Dependency versions in `package.json` are pinned. The repository does not yet contain a generated `package-lock.json`, so CI currently uses `npm install`; once a lockfile is committed, CI should switch to `npm ci`.

## Configuration

Editor defaults live in `config/lab.yaml`. It contains application/import/history limits, radial and touch interaction values, layer/group/physical numeric ranges, object/layer/channel/environment/blend catalogs, physical defaults, export settings, quality tiers and renderer settings.

The YAML document is parsed and validated at startup. Missing, duplicate, unknown or out-of-range configuration fails explicitly. Shadow-map, bake and export texture sizes are validated as powers of two.

## Controls

| Action | Control |
| --- | --- |
| Orbit | Left drag |
| Select imported mesh | Click mesh |
| Pan | Right drag |
| Zoom | Wheel / pinch |
| Radial menu | Right click, `Space`, or touch long press |
| Frame object/selected mesh | `F` |
| Wireframe | `W` |
| Bake texture maps | `Bake maps` toolbar or radial action |
| Export baked GLB | `Export GLB` toolbar or radial action |
| Quality tier | `Q` selector in the top bar |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |

Native text-field undo and normal keyboard activation of focused controls are preserved. The radial menu supports arrow keys, Home/End and Escape.

## Architecture

- `config/lab.yaml` — validated editor/material/export/performance/renderer configuration
- `src/config` — typed YAML parsing and validation
- `src/app` — project state, migrations, history, imported-file cache and orchestration
- `src/engine` — renderer, environments, procedural geometry, model loading, profiler, quality policy and GPU cleanup
- `src/export` — UV-space texture baker, bake GLSL, preset thumbnail renderer and GLB exporter
- `src/materials` — material domain model, presets, physical settings and procedural GLSL compiler
- `src/ui` — compact panels, inspector, tagged preset browser, layer dock and radial interactions
- `src/utils` — browser downloads, IDs and HTML helpers
- `scripts` — browser/WebGL production smoke and deterministic GLB fixture helpers

The procedural compiler injects a fixed-size runtime into `MeshPhysicalMaterial`. Layers are evaluated in world space after morph/skinning deformation. Masks and nested-group opacity are compiled into the same layer pass. Routed height modifies geometry and shadow passes; color/roughness/clearcoat/SSS channels only affect their intended response. Vertex displacement is converted from the desired world-normal offset back into local coordinates, which avoids skew from non-uniform transforms. Lighting normals use the smooth base normal plus screen-space derivatives of the interpolated displacement scalar, avoiding the faceted face-normal result produced by directly crossing displaced-position derivatives.

The texture baker reuses the same procedural uniforms and field functions in a dedicated UV-space shader. This keeps the authored procedural fields consistent between the realtime preview, downloaded maps and baked GLB materials.

## Project format

Current projects use format version `2`. Version `1` JSON imports are migrated automatically.

Project JSON stores:

- procedural layers, masks and groups
- physical settings
- preview object/background/wireframe
- environment selection
- imported mesh catalog and per-mesh assignments
- imported asset/HDR names as restoration metadata

Imported model bytes and custom HDR bytes are intentionally not embedded in JSON. A reopened project may therefore ask you to re-select the referenced model bundle or HDR file. In-session model bundles are cached within configured limits for undo/redo restoration.

Quality tier is an editor/runtime preference rather than material content, so it is not written into project JSON.

## Texture baking

`Bake maps` exports six PNG files for the selected imported mesh, or the first mesh currently using the lab material:

- albedo
- roughness
- normal
- height
- clearcoat
- clearcoat roughness

Texture baking requires a usable UV set. Imported meshes must have a finite, non-degenerate, unique, non-overlapping 0–1 unwrap; tiled, mirrored or overlapping imported UVs are rejected instead of silently overwriting unrelated surface regions. Procedural previewing itself does not require UVs because the procedural fields are evaluated in world space. When a built-in procedural preview mesh has UVs that are not bake-safe, the exporter can generate a deterministic triangle atlas for that procedural mesh.

The configured quality tier controls bake resolution. The renderer also caps the requested resolution to the GPU's reported maximum texture size.

## GLB export

`Export GLB` snapshots the current material/export state, removes editor-only preview normalization from imported assets, clones the source hierarchy, bakes standard PBR maps for every mesh assigned to the lab material, embeds those maps and exports binary glTF. Imported meshes that retain their original material are exported with a snapshotted copy of that material and its textures. Imported animation clips are carried into the exported file and bound to the clone of the original source hierarchy.

The export path intentionally converts the procedural runtime into conventional PBR textures instead of embedding custom GLSL. This produces a portable GLB that can be consumed by normal glTF renderers without the texture lab shader compiler.

Realtime biological SSS has no standard glTF material equivalent. The baker therefore folds a conservative SSS color contribution into albedo while preserving standard transmission/thickness/attenuation properties where available. This is an approximation rather than a physically identical SSS round-trip.

## GLTF bundles

For an external-resource GLTF, select the `.gltf`, referenced `.bin` files and textures together. Relative resources are resolved from the primary GLTF directory first and then from that explicit selection; network resources are never fetched. Missing or ambiguous resources fail with an explicit error.

## Rendering notes

The SSS layer is a realtime raster approximation intended for interactive biological-material authoring. It is not path-traced volumetric scattering. Wet-film layers modulate the physical clearcoat response per pixel. Procedural displacement modifies actual vertices and shadows; the smooth lighting normal is then perturbed from the interpolated displacement slope. This remains a raster approximation at silhouettes and is bounded by the tessellation of the preview mesh.

The baked normal map captures higher-frequency procedural displacement lighting detail, while the separately exported height map preserves the authored height field for engines or DCC tools that support displacement. Standard glTF has no core height/displacement texture slot, so the GLB exporter uses the baked normal map rather than a custom displacement extension.

## Verification

GitHub Actions installs dependencies, runs `npm run build`, and then runs `npm run test:browser` on pushes to `main` and pull requests. The browser suite launches the production Vite build in headless Chrome/SwiftShader, captures runtime/WebGL shader failures, executes a real six-map GPU bake, validates each downloaded PNG against the configured Mobile resolution, imports a deterministic two-mesh GLB fixture, preserves one original textured material, exports the other mesh through the baked PTL material, validates source TRS and glTF texture bindings in the binary result, and reloads the exported GLB through the application importer.

This smoke test covers the browser-only shader path and the main bake/export round-trip that TypeScript/Vite cannot validate statically.

## Roadmap

See [`docs/PLAN.md`](docs/PLAN.md). Phase 1, Phase 2 and Phase 3 are implemented. Remaining production follow-ups are dependency lockfile reproducibility and broader compatibility fixtures for unusually nested, multi-material, skinned and morphed assets, followed by production-driven work such as WebGPU/TSL migration, offline/path-traced reference rendering or stronger automatic UV unwrapping/packing.
