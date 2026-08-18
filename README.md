# Procedural Texture Lab

A realtime Three.js material laboratory for building layered procedural surfaces and applying them to built-in preview geometry or imported GLB/self-contained GLTF models.

## Current features

- Layered procedural material stack with live physical rendering
- Base, FBM, cellular, ridges, spots, veins and gradient generators
- Normal, multiply, add, screen and overlay blending
- Per-layer color, opacity, scale, strength, seed, roughness and displacement
- Global physical surface controls for roughness, metalness, clearcoat, clearcoat roughness, specular intensity and IOR
- Built-in sphere, icosphere, cube, rounded cube, torus and plane targets
- GLB/self-contained GLTF import plus viewport drag/drop
- Automatic model normalization and framing
- Professional compact desktop/tablet/mobile layout
- Context radial menu on right click, `Space`, or touch long press
- Draggable material layer ordering
- Material preset library including biological/adipose, marble, molten rock and alien dermis
- Undo/redo
- Wireframe preview
- PNG viewport capture
- Project JSON import/export
- localStorage autosave
- YAML configuration for editor, catalog, material and renderer defaults

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

## Configuration

Editor defaults live in `config/lab.yaml`. It contains application limits, object/layer/blend catalogs, physical surface defaults and renderer/camera settings. The configuration is parsed and validated at startup.

## Controls

| Action | Control |
| --- | --- |
| Orbit | Left drag |
| Pan | Right drag when radial menu is not open / OrbitControls gesture |
| Zoom | Wheel / pinch |
| Radial menu | Right click, `Space`, or touch long press |
| Frame object | `F` |
| Wireframe | `W` |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` |

## Architecture

The editor state, Three.js renderer, material compiler and UI are intentionally separated.

- `config/lab.yaml` — editable application and renderer configuration
- `src/config` — typed YAML parsing and validation
- `src/app` — project state and application orchestration
- `src/engine` — viewport, procedural geometry and model loading
- `src/materials` — material domain types, presets, physical settings and GLSL compiler
- `src/ui` — compact panels, layer dock and radial menu
- `src/utils` — small browser helpers

The procedural compiler injects a fixed-size layer runtime into `MeshPhysicalMaterial`, preserving Three.js physical lighting while allowing the active material stack to drive color, roughness and vertex displacement. The physical inspector controls the underlying PBR response independently from per-layer roughness contributions.

## Project format

Projects are JSON documents containing the material stack, physical material settings and viewport state. Imported model bytes are intentionally not embedded in Phase 1 project JSON; re-import the referenced GLB/GLTF when reopening a project that used an external model.

External-resource GLTF bundles are not yet imported as a multi-file package. Use GLB or a self-contained GLTF for Phase 1.

## Roadmap

See [`docs/PLAN.md`](docs/PLAN.md) for the implementation plan. Next material-focused milestones are masks/groups, biological SSS, wet-film layers, environment libraries, texture baking and optimized GLB export.
