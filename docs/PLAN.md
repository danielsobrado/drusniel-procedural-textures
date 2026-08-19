# Procedural Texture Lab — Implementation Plan

## Goal

Build a browser-based Three.js material laboratory for authoring layered procedural materials, previewing them on procedural meshes or imported GLB/GLTF assets, baking reusable PBR textures and exporting portable production assets.

The product favors a compact layer workflow over a general node editor. High-frequency actions stay in the layer dock and contextual radial menu while advanced routing remains in the inspector.

## UX

### Main layout

- **Top command bar** — project/import/export, bake, quality, undo/redo and viewport commands.
- **Left compact library** — searchable/tagged material presets with rendered thumbnails plus procedural object presets.
- **Center viewport** — realtime Three.js preview, imported-mesh picking, performance HUD and drag/drop model bundles.
- **Right inspector** — layer parameters, output routing, masks/groups, PBR, environment and mesh assignment.
- **Bottom layer strip** — reorder, enable/disable, duplicate and quick layer creation.
- **Two-ring radial menu** — right click, `Space`, or touch long press for layer/object/project/bake/export actions.

### Interaction principles

- Progressive disclosure for advanced routing and physical controls.
- Numeric fields support sliders and direct entry.
- Continuous edits coalesce into useful undo steps.
- Keyboard shortcuts do not override native text editing.
- Right-click opens the radial menu while right-drag remains viewport pan.
- Narrow layouts retain authoring, bake and export actions through the radial menu.
- Imported meshes can be selected directly in the viewport or from the inspector.
- Quality tiers control viewport cost and production bake/export resolution from one compact selector.

## Material model

A material is a stack of procedural layers with optional groups and masks.

Layer generators:

- Base color
- FBM noise
- Cellular/Worley
- Ridges
- Spots
- Veins
- Gradient
- Branching vessels
- Wet film
- Subsurface tissue

Layer output channels:

- Surface — color, roughness and height contribution
- Color
- Roughness
- Height
- Clearcoat / wetness
- SSS

Each layer exposes common procedural parameters plus:

- output channel
- optional mask source
- mask strength/inversion
- optional group membership

Groups support enable/opacity inheritance and bounded nesting. Masks use another layer's procedural field without requiring duplicate texture assets.

Global physical controls remain independent from layer routing:

- roughness / metalness
- clearcoat / clearcoat roughness
- specular intensity / IOR
- sheen / tint / roughness
- transmission / thickness
- attenuation distance/color

## Biological material depth

Phase 2 adds dedicated realtime biological responses:

- warped multi-frequency branching vessel field
- SSS/tissue layer with view-dependent internal-color scattering approximation
- wet-film layer driving per-pixel clearcoat and clearcoat roughness
- adipose SSS preset combining fat, lobules, fascia, vessels, scattering and membrane wetness

The SSS implementation is an interactive raster approximation, not path-traced volumetric transport.

## Geometry and imported assets

Built-in targets:

- UV sphere
- Icosphere
- Cube
- Rounded cube
- Torus
- Plane

Imported targets:

- GLB
- self-contained GLTF
- GLTF bundles containing external BIN/image resources selected together

Importer behavior:

- enforce configured total bundle size
- validate GLB headers/chunks and UTF-8 JSON
- reject remote resource URIs
- resolve external resources relative to the primary GLTF directory before explicit-bundle basename fallback
- preserve parent-directory segments while canonicalizing GLTF resource paths
- fail on missing/ambiguous bundle resources
- reject assets without mesh geometry
- normalize imported models to a preview volume without changing source hierarchy/transforms used by export
- compute missing vertex normals
- annotate imported meshes with stable in-load target IDs
- expose per-mesh selection/material assignment
- retain original mesh materials while they may be restored
- keep bounded in-session bundles for undo/redo restoration
- cancel stale imports and dispose superseded resources

## Rendering

Current renderer:

- Three.js WebGLRenderer
- ACES filmic tone mapping
- PMREM environment reflections
- neutral/warm/cool/night studio profiles
- imported Radiance HDR environments
- configurable background and wireframe
- procedural displacement after morph/skinning deformation
- matching depth/distance shadow displacement
- displacement-aware framing
- selected imported-mesh outline and framing
- per-mesh lab/original material switching
- displaced-normal reconstruction using screen-space derivatives of displaced world position
- per-pixel wet-film clearcoat
- realtime SSS approximation
- explicit GPU resource cleanup
- PNG capture without permanent `preserveDrawingBuffer`
- configurable Auto/Mobile/Balanced/High/Ultra quality tiers
- realtime FPS/frame-time/draw-call/triangle/resource profiler

## Production baking and export

Phase 3 converts the realtime procedural material into conventional portable PBR assets.

Texture baker:

- renders the same procedural field/runtime into UV space
- bakes albedo, roughness, tangent-space normal, height, clearcoat and clearcoat-roughness maps
- uses current morph/skinning-deformed vertex positions for bake geometry
- snapshots bake geometry, transforms and procedural uniforms before asynchronous export work
- preserves normalized-world procedural scale through the source mesh world transform
- dilates UV islands by a configured padding distance to reduce filtering seams
- validates finite 0–1 UV coordinates and rejects overlapping/mirrored imported UV islands
- creates a deterministic triangle atlas for built-in procedural meshes only when their native UVs are not bake-safe
- exports PNG maps
- clamps requested bake resolution to the GPU texture-size capability
- fails explicitly when an imported target mesh has no usable unique UV coordinates

GLB exporter:

- strips editor-only preview normalization and clones the imported source hierarchy without mutating the editor scene
- preserves source origin, scale and local transforms
- snapshots assignment state, physical settings, bake uniforms, source geometry and world-space bake transforms before asynchronous baking
- snapshots original imported materials/textures, including ImageBitmap content, so replacing the live preview cannot invalidate an in-flight export
- bakes every mesh assigned to the lab material
- converts those meshes to standard `MeshPhysicalMaterial` texture inputs
- carries generated procedural UV-atlas geometry into the exported GLB when required
- keeps original materials on imported meshes not assigned to the lab material
- embeds images in binary glTF
- constrains export texture size by quality tier
- avoids custom procedural GLSL in the exported asset
- approximates realtime SSS in baked albedo because standard glTF has no direct SSS material model

Standard glTF has no core displacement/height texture slot. Height is therefore exported as a separate PNG, while GLB uses the baked normal map to preserve surface lighting detail.

## Preset production workflow

The preset browser now provides:

- text search across name, description and tags
- tag chips for fast filtering
- GPU-rendered material sphere thumbnails using the preset's real procedural material and PBR settings
- searchable preset metadata without changing the material project format

## Configuration

`config/lab.yaml` owns user/editor tunables:

- limits and persistence/history timing
- import limits
- radial/touch interaction settings
- layer/group/physical numeric ranges
- object, layer, output-channel, environment and blend catalogs
- default physical material and environment
- export filenames, thumbnail size and texture-island padding
- default/automatic quality policy
- per-tier pixel ratio, shadow size, bake resolution and GLB texture limit
- camera/renderer settings including displaced-normal strength

Configuration is parsed and range-validated at startup. Unknown, missing or duplicate catalog/range entries fail explicitly. Texture and shadow dimensions that require power-of-two behavior are validated as powers of two.

## Project persistence

Project format version `2` stores:

- selected object and viewport state
- physical settings
- material layers
- masks and groups
- environment selection
- imported mesh target catalog
- per-mesh lab-material assignments
- imported asset/HDR names as restoration metadata

Version `1` project JSON migrates to version `2` on import.

Initial persistence remains JSON/localStorage. Imported model/HDR bytes are not embedded in project JSON; model bundles are cached only in-session within configured limits. Quality tier remains an editor/runtime preference and is not material project content.

## Architecture

```text
config/
  lab.yaml
src/
  app/
    App.ts
    AppState.ts
    ImportedFileCache.ts
    ProjectFile.ts
    constants.ts
  config/
    labConfig.ts
  engine/
    EnvironmentLibrary.ts
    LabRenderer.ts
    MeshFactory.ts
    ModelLoader.ts
    ObjectResources.ts
    PerformanceProfiler.ts
    Quality.ts
  export/
    GlbExporter.ts
    PresetThumbnailRenderer.ts
    TextureBaker.ts
    TextureBakeShader.ts
  materials/
    MaterialCompiler.ts
    PhysicalMaterial.ts
    ProceduralShader.ts
    presets.ts
    types.ts
  ui/
    Inspector.ts
    LayerStrip.ts
    LibraryPanel.ts
    RadialMenu.ts
    Shell.ts
  utils/
    download.ts
    html.ts
    ids.ts
  styles/
    app.css
    refinements.css
```

Rules:

- UI never mutates Three.js scene objects directly.
- `AppState` is the editable source of truth.
- Untrusted project/import/config data is validated before use.
- Async model/project operations use last-action-wins semantics.
- Engine code reacts to explicit state changes.
- Material compilation is deterministic for a given stack/group state.
- Bake shaders reuse the procedural compiler's field semantics rather than reimplementing material logic in the UI.
- Export operates on clones/snapshots and does not mutate editor scene resources.
- Replaced Three.js resources are explicitly disposed without invalidating retained shared/original resources.
- Editor, export and quality defaults come from validated YAML.

## Delivery phases

### Phase 1 — Working lab — implemented

- responsive professional shell
- procedural primitives
- GLB/self-contained GLTF import
- seven initial procedural generators
- PBR material composition
- morph/skinning-aware displacement and matching shadows
- radial menu, layer inspector and dock
- presets, undo/redo, JSON persistence and autosave
- PNG capture
- validated YAML configuration
- CI production build workflow

### Phase 2 — Material depth — implemented

- channel routing per layer
- procedural layer masks
- nested opacity/enabled groups
- dedicated SSS biological layer
- wet-film/clearcoat layer
- improved branching-vessel generator
- built-in environment profiles and custom HDR import
- per-mesh selection/material assignment for imported scenes
- displaced-normal reconstruction for procedural displacement
- multi-file GLTF asset bundles
- project-format migration and validation for Phase 2 state

### Phase 3 — Production export — implemented

- albedo/roughness/clearcoat texture baking
- tangent-space normal and height baking
- UV-island dilation padding
- morph/skinning-aware bake source geometry
- imported UV safety validation and procedural-only bake-atlas fallback
- baked standard-PBR binary GLB export
- source-transform preservation for imported GLB export
- immutable whole-export snapshots
- per-mesh material preservation during export
- conservative SSS-to-albedo export approximation
- rendered material thumbnails
- preset browser search and tags
- realtime performance profiler
- Auto/Mobile/Balanced/High/Ultra quality tiers
- compact toolbar plus two-ring radial bake/export workflow
- YAML validation for export and performance policy

## Phase 3 acceptance criteria

- `Bake maps` exports albedo, roughness, normal, height, clearcoat and clearcoat-roughness PNGs from the authored procedural stack.
- Baked color/roughness/clearcoat values use the same layer masks, groups and channel routing as the realtime material.
- Baked normal detail is derived from the procedural displacement field.
- Current morph/skinning deformation is snapshotted when generating bake geometry.
- Baking rejects missing, non-finite, tiled/out-of-range or overlapping imported UV layouts instead of silently producing ambiguous maps.
- Built-in procedural meshes can generate a deterministic fallback UV atlas when needed.
- Imported GLB export retains source hierarchy, origin, scale and transforms rather than editor preview normalization.
- Multi-mesh GLB export uses one immutable material/assignment/bake snapshot from start to finish.
- GLB export embeds conventional PBR textures and does not depend on the lab's custom runtime shader.
- Imported meshes not assigned to the lab material keep a snapshotted copy of their original material in the exported hierarchy.
- Realtime SSS loss in standard glTF is explicitly approximated in baked albedo rather than silently discarded.
- Presets can be filtered by text or tag and display generated material thumbnails.
- The viewport reports FPS, frame time, draw calls, triangles, geometries and textures.
- Quality tier controls pixel ratio, shadow resolution, bake resolution and export texture limits.
- Mobile/narrow layouts retain Bake and GLB actions through the radial menu even when toolbar export buttons are hidden.
- Production CI continues to run `npm run build` on `main`.

## Verification follow-ups

- Generate and commit `package-lock.json`, then switch CI from `npm install` to `npm ci`.
- Add a real browser/WebGL smoke suite that compiles injected procedural/bake GLSL.
- Bake a deterministic fixture and verify non-empty/aligned maps.
- Export and reload fixture GLBs to verify source transforms, original-material preservation and texture bindings.
- Expand compatibility testing across unusually nested, multi-material, skinned and morphed production assets.

## Future work

The core three-phase editor is complete. Further work should be selected by production need rather than added automatically. Candidate follow-ups are stronger automatic UV unwrapping/packing, atlas packing across multiple material targets, WebGPU/TSL migration, offline/path-traced reference rendering, mesh-displacement baking for silhouette-preserving export and specialized DCC/engine export profiles.
