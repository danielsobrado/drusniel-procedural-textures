# Procedural Texture Lab

A realtime Three.js material laboratory for building layered procedural surfaces and applying them to built-in preview geometry or imported GLB/self-contained GLTF models.

## Current features

- Layered procedural material stack with live physical rendering
- Base, FBM, cellular, ridges, spots, veins and gradient generators
- Normal, multiply, add, screen and overlay blending
- Per-layer color, opacity, scale, strength, seed, roughness and displacement
- Global physical surface controls for roughness, metalness, clearcoat, clearcoat roughness, specular intensity and IOR
- Advanced physical controls for sheen, transmission, thickness and volumetric attenuation color/distance
- Built-in sphere, icosphere, cube, rounded cube, torus and plane targets
- GLB/self-contained GLTF import plus viewport drag/drop
- Configured model/project import size limits
- Automatic model normalization, stale-operation cancellation and GPU resource cleanup
- Morph/skinning-aware procedural displacement with matching depth/distance shadow passes
- Strict project JSON validation with migration of older physical settings
- Bounded in-session imported-file restoration for undo/redo
- Professional compact desktop/tablet/mobile layout
- Context radial menu on right click, `Space`, or touch long press, including project Open/Save access on narrow layouts without breaking right-drag viewport panning
- Drag-and-drop layer ordering plus touch-friendly move controls
- Material preset library including biological/adipose, marble, molten rock and alien dermis
- Coalesced undo/redo for continuous slider and color edits
- Wireframe preview
- PNG viewport capture without permanently preserving the WebGL drawing buffer
- Project JSON import/export
- localStorage autosave
- Validated YAML configuration for editor, interaction, numeric control ranges, catalog, material and renderer defaults

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

Editor defaults live in `config/lab.yaml`. It contains application limits, import limits, history/autosave timing, radial/touch interaction values, layer and physical-control ranges, object/layer/blend catalogs, physical surface defaults and renderer/camera settings. The configuration is parsed and validated at startup; invalid or incomplete configuration fails explicitly instead of being cast into the runtime types.

## Controls

| Action | Control |
| --- | --- |
| Orbit | Left drag |
| Pan | Right drag |
| Zoom | Wheel / pinch |
| Radial menu | Right click, `Space`, or touch long press |
| Frame object | `F` |
| Wireframe | `W` |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |

Native text-field undo and normal keyboard activation of focused buttons/menu items are preserved.

## Architecture

The editor state, Three.js renderer, material compiler and UI are intentionally separated.

- `config/lab.yaml` — editable application, interaction, material, control-range and renderer configuration
- `src/config` — typed YAML parsing and validation
- `src/app` — project state, bounded imported-file restoration, project-file validation and application orchestration
- `src/engine` — viewport, procedural geometry, model loading and Three.js resource cleanup
- `src/materials` — material domain types, presets, physical settings and isolated GLSL compiler/source
- `src/ui` — compact panels, layer dock, touch interaction and radial menu
- `src/utils` — browser downloads, IDs and safe HTML helpers

The procedural compiler injects a fixed-size layer runtime into `MeshPhysicalMaterial`, preserving Three.js physical lighting while allowing the active material stack to drive color, roughness and vertex displacement. Procedural displacement is evaluated after morph/skinning deformation in normalized world space, so imported mesh transforms and source units do not unexpectedly change texture scale. Custom depth/distance materials apply the same displacement to shadow passes. The physical inspector controls the underlying PBR response independently from per-layer roughness contributions and can enable sheen/transmission volume features when required.

## Project format

Projects are JSON documents containing the material stack, physical material settings and viewport state. Project files and autosaves are normalized and range-validated before entering application state. Persisted names and IDs are length/format checked. Imported model bytes are intentionally not embedded in Phase 1 project JSON; re-import the referenced GLB/GLTF when reopening a project that used an external model.

External-resource GLTF bundles are rejected before loading. Use GLB or a self-contained GLTF for Phase 1. This avoids partially loaded models and unexpected external-resource requests.

## Verification

The repository includes a GitHub Actions workflow that installs dependencies and runs `npm run build` on pushes to `main` and pull requests. Local verification uses the same production build command above.

## Roadmap

See [`docs/PLAN.md`](docs/PLAN.md) for the implementation plan. Next material-focused milestones are masks/groups, dedicated biological SSS, procedural wet-film masks, environment libraries, displaced-normal lighting, texture baking and optimized GLB export.
