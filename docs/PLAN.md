# Procedural Texture Lab — Implementation Plan

## Goal

Build a browser-based Three.js material laboratory for authoring layered procedural materials, previewing them on procedural meshes or imported GLB/GLTF assets, and saving/reusing material presets.

The product favors a compact layer workflow over a general node editor. High-frequency actions stay in the layer dock and contextual radial menu while advanced routing remains in the inspector.

## UX

### Main layout

- **Top command bar** — project/import/export, undo/redo and viewport commands.
- **Left compact library** — material presets and procedural object presets.
- **Center viewport** — realtime Three.js preview, imported-mesh picking and drag/drop model bundles.
- **Right inspector** — layer parameters, output routing, masks/groups, PBR, environment and mesh assignment.
- **Bottom layer strip** — reorder, enable/disable, duplicate and quick layer creation.
- **Radial menu** — right click, `Space`, or touch long press for common layer/object/project actions.

### Interaction principles

- Progressive disclosure for advanced routing and physical controls.
- Numeric fields support sliders and direct entry.
- Continuous edits coalesce into useful undo steps.
- Keyboard shortcuts do not override native text editing.
- Right-click opens the radial menu while right-drag remains viewport pan.
- Narrow layouts retain authoring features through the radial menu.
- Imported meshes can be selected directly in the viewport or from the inspector.

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

Groups support enable/opacity inheritance and bounded nesting. Masks use another layer's procedural field without requiring duplicate texture evaluation assets.

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
- resolve external resources only from the explicitly selected local bundle
- fail on missing/ambiguous bundle resources
- reject assets without mesh geometry
- normalize imported models to a preview volume
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

## Configuration

`config/lab.yaml` owns user/editor tunables:

- limits and persistence/history timing
- import limits
- radial/touch interaction settings
- layer/group/physical numeric ranges
- object, layer, output-channel, environment and blend catalogs
- default physical material and environment
- camera/renderer settings including displaced-normal strength

Configuration is parsed and range-validated at startup. Unknown, missing or duplicate catalog/range entries fail explicitly.

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

Initial persistence remains JSON/localStorage. Imported model/HDR bytes are not embedded in project JSON; model bundles are cached only in-session within configured limits.

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
- Replaced Three.js resources are explicitly disposed without invalidating retained shared/original resources.
- Editor defaults and numeric ranges come from validated YAML.

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

### Phase 3 — Production export

- texture baking
- normal/height baking
- optimized GLB export
- material thumbnails
- preset browser/search/tags
- performance profiler and mobile quality tiers

## Phase 2 acceptance criteria

- A layer can target color, roughness, height, clearcoat or SSS independently.
- A layer can use another layer as a mask and invert/scale the mask.
- Layers can belong to nested groups with inherited enable/opacity.
- Wet-film layers visibly alter clearcoat locally.
- SSS layers add visible internal tissue depth without replacing the PBR surface.
- Branching-vessel layers produce multi-scale vascular structures.
- Displaced geometry uses matching shadow displacement and corrected surface normals.
- Users can switch among built-in studio environments and load a local HDR.
- Imported scenes expose selectable mesh targets and per-mesh lab-material assignment.
- External-resource GLTFs load when their resource bundle is selected together and never silently fetch remote resources.
- Version-1 project JSON imports into the version-2 model.
- Production CI continues to run `npm run build` on `main`.

Runtime/browser verification still depends on the repository CI or a local environment with package-registry access.
