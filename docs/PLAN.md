# Procedural Texture Lab — Implementation Plan

## Goal

Build a browser-based Three.js material laboratory for authoring layered procedural materials, previewing them on procedural meshes or imported GLB/GLTF assets, and saving/reusing material presets.

The first implementation focuses on a fast professional editing workflow rather than a general node editor. A compact layer stack plus contextual radial actions gives most of the power with less UI overhead.

## UX

### Main layout

- **Top command bar** — project/preset actions, viewport mode, import, export, undo/redo.
- **Left compact library** — material presets, procedural object presets, imported assets.
- **Center viewport** — Three.js realtime preview with orbit controls and drag/drop GLB support.
- **Right inspector** — parameters for the selected material layer, physical surface and renderer.
- **Bottom layer strip** — reorder, enable/disable, duplicate and quick layer creation.
- **Radial menu** — right click, `Space`, or touch long press for high-frequency contextual actions.

### Interaction principles

- Progressive disclosure: advanced parameters stay grouped until requested.
- Most-used controls remain within one click.
- Numeric fields support direct entry and sliders.
- Layer reordering is drag-and-drop on desktop; touch can still edit/select/add through compact controls and the radial menu.
- Every material update is previewed immediately.
- Continuous edits coalesce into useful undo steps instead of one history entry per input event.
- Keyboard shortcuts cover the common workflow without overriding native undo while editing a field.
- Right-click opens the radial menu while right-drag remains available for viewport panning.
- Narrow layouts reorganize panels without removing authoring features.

## Material model

A material is a stack of procedural layers. Each layer owns common properties and type-specific parameters.

Initial layer types:

- Base color
- FBM noise
- Cellular/Worley
- Ridges
- Spots
- Veins
- Gradient

Each layer exposes:

- enabled
- blend mode
- opacity
- scale
- strength
- two colors
- seed
- roughness contribution
- displacement contribution

Initial blend modes:

- normal
- multiply
- add
- screen
- overlay

The shader compiler evaluates the active stack inside `MeshPhysicalMaterial`. Color, roughness and displacement use the same procedural fields so layers remain spatially coherent. Procedural coordinates are evaluated after morph/skinning deformation and in normalized world space so imported meshes with different source units, skinning and sub-mesh transforms receive a consistent material scale. Layer strength is centered around the generator midpoint, so zero strength produces a neutral field rather than maximum negative displacement.

Global physical controls are independent from layer contributions:

- base roughness
- metalness
- clearcoat
- clearcoat roughness
- specular intensity
- IOR
- sheen and sheen roughness/tint
- transmission and thickness
- attenuation distance/color

## Geometry

Built-in procedural targets:

- UV sphere
- Icosphere
- Cube
- Rounded cube
- Torus
- Plane

Imported targets:

- GLB
- self-contained GLTF

Imported mesh handling:

- validate GLB container metadata before parsing
- reject external GLTF resource URIs before loading
- enforce configured model-file size limits before reading
- reject assets without mesh geometry
- traverse all meshes
- preserve model hierarchy/transforms
- normalize to a preview volume
- compute missing vertex normals
- apply the lab material to mesh nodes while preserving line/point resources
- dispose replaced source materials, textures, geometries and skeleton GPU resources
- discard and clean stale concurrent imports
- cancel an in-flight import when a newer object/project action supersedes it
- keep a bounded in-session file cache for safe undo/redo restoration
- frame imported content automatically, including narrow viewport aspect ratios

Multi-file GLTF packages with external buffers/textures are deferred until the importer can accept a complete asset bundle rather than silently resolving missing files.

## Rendering

Phase 1 renderer:

- Three.js WebGLRenderer
- ACES filmic tone mapping
- PMREM `RoomEnvironment` for neutral PBR reflections
- key/fill/rim studio lighting
- configurable background
- optional wireframe
- procedural vertex displacement after morph/skinning deformation
- matching procedural depth/distance shadow passes
- physical material controls
- displacement-aware framing and conservative culling behavior
- explicit resource cleanup when preview objects are replaced
- screenshot capture without permanently preserving the WebGL drawing buffer

The architecture keeps renderer/material services isolated so WebGPU/TSL, improved displaced normals and dedicated biological scattering can be added without rewriting the UI or project model.

## Configuration

Editable application and renderer defaults live in `config/lab.yaml` rather than being spread through feature code. The YAML configuration owns:

- application limits and persistence/history timing
- model/project import size limits
- radial and touch interaction timing/layout
- layer and physical-control numeric ranges
- object/layer/blend catalogs
- default physical material values
- default viewport/background
- camera and renderer limits

The YAML document is parsed and range-validated at startup. Supported catalogs and numeric control groups are checked for missing, duplicate and unknown IDs/keys. Algorithm-specific shader constants remain local to the implementation where they are part of the generator itself rather than deployment/editor configuration.

## Project persistence

A project document contains:

- selected object preset
- viewport configuration
- physical material settings
- material layer stack
- imported asset metadata

Initial persistence:

- localStorage autosave
- JSON export/import
- configured project-file size limit before reading
- strict runtime validation of project structure, enums, ranges, IDs, colors and persisted string lengths
- migration of older Phase 1 JSON that predates advanced physical-surface settings
- coalesced undo history for continuous editor changes
- bounded in-session imported-file restoration cache; imported bytes are not persisted in project JSON

Later:

- bundled external asset references
- GLB material bake/export
- texture baking (albedo/roughness/normal/displacement)
- shareable project files

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
    LabRenderer.ts
    MeshFactory.ts
    ModelLoader.ts
    ObjectResources.ts
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
    LongPressContextMenu.ts
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

- UI does not mutate Three.js scene objects directly.
- `AppState` is the source of truth for the editable project.
- Untrusted project/import data is validated before entering application state or resource loading.
- Async model/project operations use last-action-wins cancellation semantics.
- Engine code reacts to explicit state changes.
- Material compilation is isolated and deterministic for a given layer stack.
- Three.js resources replaced by the lab are explicitly disposed without invalidating retained shared resources.
- User/editor defaults and numeric editor ranges are sourced from validated YAML configuration.
- No UI framework is required for Phase 1; TypeScript + DOM keeps the first implementation small and transparent.

## Delivery phases

### Phase 1 — Working lab

Implemented in `main`:

- Professional responsive shell
- Procedural primitives
- GLB/self-contained GLTF import and drag/drop
- Input/container validation, import size limits and stale-operation protection
- Layer stack with seven procedural layer types
- Live physical shader composition
- Morph/skinning-aware procedural displacement with matching shadow passes
- Compact layer and physical-surface inspector
- Desktop + touch + keyboard radial menu without breaking right-drag panning
- Material presets
- Strict JSON project import/export
- local autosave
- coalesced undo/redo and keyboard shortcuts
- PNG viewport capture
- Validated YAML application/UI/control configuration
- CI build workflow
- Three.js resource cleanup for replaced/imported preview assets

Build/runtime verification still needs a dependency install/browser run in an environment with package-registry access; the repository includes CI for that verification.

### Phase 2 — Material depth

- channel routing per layer
- layer masks and nested groups
- dedicated SSS/transmission biological layer
- wet-film/clearcoat layer type
- better procedural vessel branching
- environment/HDRI library
- per-mesh selection and material assignment for imported scenes
- displaced-normal strategy for stronger displacement lighting on arbitrary imported meshes
- multi-file GLTF asset bundles

### Phase 3 — Production export

- texture baking
- normal/height baking
- export optimized GLB
- material thumbnails
- preset browser/search/tags
- performance profiler and mobile quality tiers

## Acceptance criteria for Phase 1

- `npm install && npm run dev` starts the lab.
- Default material renders immediately.
- User can add, remove, reorder, enable and edit layers.
- Procedural changes update the mesh in real time.
- Global PBR controls update the same material independently of layer roughness deltas.
- User can switch among built-in meshes.
- User can drag/drop or import GLB/self-contained GLTF.
- Unsupported external GLTF resources fail explicitly instead of causing hidden network requests.
- Superseded model/project imports cannot overwrite a newer user action.
- Radial menu works with mouse, keyboard and touch long press while right-drag still pans.
- Project JSON can be exported and safely imported.
- Layout remains usable on desktop, tablet and narrow mobile screens.
