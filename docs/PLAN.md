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
- Keyboard shortcuts cover the common workflow.
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

The shader compiler evaluates the active stack inside `MeshPhysicalMaterial`. Color, roughness and displacement use the same procedural fields so layers remain spatially coherent.

Global physical controls are independent from layer contributions:

- base roughness
- metalness
- clearcoat
- clearcoat roughness
- specular intensity
- IOR

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

- traverse all meshes
- preserve model hierarchy/transforms
- normalize to a preview volume
- apply the lab material to mesh nodes
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

The architecture keeps renderer/material services isolated so WebGPU/TSL, improved displaced normals and dedicated biological scattering can be added without rewriting the UI or project model.

## Configuration

Editable application and renderer defaults live in `config/lab.yaml` rather than being spread through feature code. The YAML configuration owns:

- application limits and persistence timing
- object/layer/blend catalogs
- default physical material values
- default viewport/background
- camera and renderer limits

Algorithm-specific shader constants remain local to the implementation where they are part of the generator itself rather than deployment/editor configuration.

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
- migration of older Phase 1 JSON that predates physical-surface settings

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
    constants.ts
  config/
    labConfig.ts
  engine/
    LabRenderer.ts
    MeshFactory.ts
    ModelLoader.ts
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
    ids.ts
  styles/
    app.css
```

Rules:

- UI does not mutate Three.js scene objects directly.
- `AppState` is the source of truth for the editable project.
- Engine code reacts to explicit state changes.
- Material compilation is isolated and deterministic for a given layer stack.
- User/editor defaults are sourced from YAML configuration.
- No UI framework is required for Phase 1; TypeScript + DOM keeps the first implementation small and transparent.

## Delivery phases

### Phase 1 — Working lab

Implemented in `main`:

- Professional responsive shell
- Procedural primitives
- GLB/self-contained GLTF import and drag/drop
- Layer stack with seven procedural layer types
- Live physical shader composition
- Compact layer and physical-surface inspector
- Desktop + touch radial menu
- Material presets
- JSON project import/export
- local autosave
- undo/redo and keyboard shortcuts
- PNG viewport capture
- YAML application configuration
- CI build workflow

Build/runtime verification still needs a real dependency install/browser run after checkout; the repository includes CI for that verification.

### Phase 2 — Material depth

- channel routing per layer
- layer masks and nested groups
- dedicated SSS/transmission biological layer
- wet-film/clearcoat layer type
- better procedural vessel branching
- environment/HDRI library
- per-mesh selection and material assignment for imported scenes
- tangent/normal strategy for stronger displacement on arbitrary imported meshes
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
- Radial menu works with mouse, keyboard and touch long press.
- Project JSON can be exported and imported.
- Layout remains usable on desktop, tablet and narrow mobile screens.
