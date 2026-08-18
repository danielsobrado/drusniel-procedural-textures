# Procedural Texture Lab — Implementation Plan

## Goal

Build a browser-based Three.js material laboratory for authoring layered procedural materials, previewing them on procedural meshes or imported GLB/GLTF assets, and saving/reusing material presets.

The first implementation focuses on a fast professional editing workflow rather than a general node editor. A compact layer stack plus contextual radial actions gives most of the power with less UI overhead.

## UX

### Main layout

- **Top command bar** — project/preset actions, viewport mode, import, export, undo/redo.
- **Left compact library** — material presets, procedural object presets, imported assets.
- **Center viewport** — Three.js realtime preview with orbit controls and drag/drop GLB support.
- **Right inspector** — parameters for the selected material layer, object, and renderer.
- **Bottom layer strip** — reorder, enable/disable, duplicate, blend mode, opacity and quick layer creation.
- **Radial menu** — right click or `Space` for contextual high-frequency actions: add layer, add primitive, import mesh, frame selection, reset view, duplicate layer, toggle wireframe.

### Interaction principles

- Progressive disclosure: advanced parameters stay collapsed until requested.
- Most-used controls remain within one click.
- Numeric fields support direct entry and sliders.
- Layer reordering is drag-and-drop.
- Every material update is previewed immediately.
- Keyboard shortcuts cover the common workflow.
- UI remains usable on tablet/mobile by collapsing side panels into drawers.

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

The shader compiler emits GLSL from the active stack. Color, roughness and displacement use the same procedural field so the material reads as one coherent surface rather than disconnected texture channels.

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
- GLTF

Imported mesh handling:

- traverse all meshes
- preserve transforms
- optionally normalize to a preview volume
- apply the lab material to all or selected mesh nodes
- frame imported content automatically

## Rendering

Initial renderer:

- Three.js WebGLRenderer
- ACES filmic tone mapping
- physically useful key/fill/rim studio lighting
- configurable background
- optional wireframe
- procedural displacement in the vertex shader
- derivative-based displaced normals in the fragment shader

The architecture keeps renderer/material services isolated so WebGPU/TSL can be added later without rewriting the UI or project model.

## Project persistence

A project document contains:

- selected object preset
- viewport configuration
- material layer stack
- imported asset metadata

Initial persistence:

- localStorage autosave
- JSON export/import

Later:

- GLB material bake/export
- texture baking (albedo/roughness/normal/displacement)
- shareable project files

## Architecture

```text
src/
  app/
    App.ts
    AppState.ts
    constants.ts
  engine/
    LabRenderer.ts
    MeshFactory.ts
    ModelLoader.ts
  materials/
    MaterialCompiler.ts
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
    ids.ts
  styles/
    app.css
```

Rules:

- UI does not mutate Three.js objects directly.
- `AppState` is the source of truth for the editable project.
- Engine code reacts to explicit state changes.
- Material compilation is isolated and deterministic.
- Constants live outside feature logic.
- No framework is required for the first version; TypeScript + DOM keeps the bundle and concepts small.

## Delivery phases

### Phase 1 — Working lab

- Professional responsive shell
- Procedural primitives
- GLB/GLTF import and drag/drop
- Layer stack with seven procedural layer types
- Live shader compilation
- Compact inspector
- Radial menu
- Presets
- JSON project import/export
- local autosave
- keyboard shortcuts

### Phase 2 — Material depth

- channel routing per layer
- masks and nested groups
- SSS/transmission biological layer
- wet-film/clearcoat layer
- better procedural vessels
- environment/HDRI library
- per-mesh material assignment for imported scenes

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
- User can switch among built-in meshes.
- User can drag/drop or import GLB/GLTF.
- Radial menu works with mouse/touch-compatible pointer input.
- Project JSON can be exported and imported.
- Layout works on desktop and collapses cleanly on narrow screens.
