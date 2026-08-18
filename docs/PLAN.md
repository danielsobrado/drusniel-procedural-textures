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

The shader compiler evaluates the active stack inside `MeshPhysicalMaterial`. Color, roughness and displacement use the same procedural fields so layers remain spatially coherent. Procedural coordinates are evaluated in normalized world space so imported meshes with different source units and sub-mesh transforms receive a consistent material scale.

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
- traverse all meshes
- preserve model hierarchy/transforms
- normalize to a preview volume
- compute missing vertex normals
- apply the lab material to mesh nodes
- dispose replaced source materials/textures
- discard and clean stale concurrent imports
- frame imported content automatically

Multi-file GLTF packages with external buffers/textures are deferred until the importer can accept a complete asset bundle rather than silently resolving missing files.

## Rendering

Phase 1 renderer:

- Three.js WebGLRenderer
- ACES filmic tone mapping
- PMREM `RoomEnvironment` for neutral PBR reflections
- key/fill/rim studio lighting
- configurable background
- optional wireframe
- procedural vertex displacement
- physical material controls
- explicit resource cleanup when preview objects are replaced

The architecture keeps renderer/material services isolated so WebGPU/TSL, improved displaced normals and dedicated biological scattering can be added without rewriting the UI or project model.

## Configuration

Editable application and renderer defaults live in `config/lab.yaml` rather than being spread through feature code. The YAML configuration owns:

- application limits and persistence/history timing
- radial and touch interaction timing/layout
- object/layer/blend catalogs
- default physical material values
- default viewport/background
- camera and renderer limits

The YAML document is parsed and range-validated at startup. Supported catalogs are checked for missing, duplicate and unknown IDs. Algorithm-specific shader constants remain local to the implementation where they are part of the generator itself rather than deployment/editor configuration.

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
- strict runtime validation of project structure, enums, ranges, IDs and colors
- migration of older Phase 1 JSON that predates advanced physical-surface settings
- coalesced undo history for continuous editor changes

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
- Engine code reacts to explicit state changes.
- Material compilation is isolated and deterministic for a given layer stack.
- Three.js resources replaced by the lab are explicitly disposed.
- User/editor defaults are sourced from validated YAML configuration.
- No UI framework is required for Phase 1; TypeScript + DOM keeps the first implementation small and transparent.

## Delivery phases

### Phase 1 — Working lab

Implemented in `main`:

- Professional responsive shell
- Procedural primitives
- GLB/self-contained GLTF import and drag/drop
- Input/container validation and stale-import protection
- Layer stack with seven procedural layer types
- Live physical shader composition
- Compact layer and physical-surface inspector
- Desktop + touch + keyboard radial menu
- Material presets
- Strict JSON project import/export
- local autosave
- coalesced undo/redo and keyboard shortcuts
- PNG viewport capture
- Validated YAML application/UI configuration
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
- displaced-normal and shadow-depth strategy for stronger displacement on arbitrary imported meshes
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
- Radial menu works with mouse, keyboard and touch long press.
- Project JSON can be exported and safely imported.
- Layout remains usable on desktop, tablet and narrow mobile screens.
