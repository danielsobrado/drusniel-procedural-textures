# Procedural Texture Lab

A realtime Three.js material laboratory for building layered procedural surfaces and applying them to built-in preview geometry or imported GLB/GLTF models.

## Current features

### Procedural authoring

- Layered procedural material stack with live physical rendering
- Base, FBM, cellular, ridges, spots, veins, gradient, branching vessels, wet-film and subsurface-tissue generators
- Normal, multiply, add, screen and overlay blending
- Per-layer output routing to surface, color, roughness, height, clearcoat/wetness or SSS
- Layer masks sourced from another procedural layer with strength and inversion
- Nested material groups with enable/opacity inheritance
- Per-layer color, opacity, scale, strength, seed, roughness and displacement
- Displacement-aware fragment normals reconstructed from the displaced surface
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
- Automatic model normalization, missing-normal generation, stale-operation cancellation and GPU cleanup
- Imported scenes expose individual mesh targets
- Click a mesh in the viewport or choose it in the inspector
- Apply/remove the lab material per imported mesh while preserving its original material
- Selected-mesh framing and viewport outline

### Editor workflow

- Compact responsive desktop/tablet/mobile layout
- Context radial menu on right click, `Space`, or touch long press
- Drag-and-drop layer ordering plus touch-friendly move controls
- Material preset library
- Coalesced undo/redo for continuous edits
- Wireframe preview and PNG capture
- Project JSON import/export and localStorage autosave
- Version-1 project migration to the current version-2 format
- Validated YAML configuration for limits, controls, catalogs, environments and renderer defaults

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

Editor defaults live in `config/lab.yaml`. It contains application/import/history limits, radial and touch interaction values, layer/group/physical numeric ranges, object/layer/channel/environment/blend catalogs, physical defaults and renderer settings.

The YAML document is parsed and validated at startup. Missing, duplicate, unknown or out-of-range configuration fails explicitly.

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
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |

Native text-field undo and normal keyboard activation of focused controls are preserved. The radial menu supports arrow keys, Home/End and Escape.

## Architecture

- `config/lab.yaml` — validated editor/material/renderer configuration
- `src/config` — typed YAML parsing and validation
- `src/app` — project state, migrations, history, imported-file cache and orchestration
- `src/engine` — renderer, environments, procedural geometry, model loading and GPU resource cleanup
- `src/materials` — material domain model, presets, physical settings and procedural GLSL compiler
- `src/ui` — compact panels, inspector, layer dock and radial interactions
- `src/utils` — browser downloads, IDs and HTML helpers

The procedural compiler injects a fixed-size runtime into `MeshPhysicalMaterial`. Layers are evaluated in normalized world space after morph/skinning deformation. Masks and nested-group opacity are compiled into the same layer pass. Routed height modifies geometry and shadow passes; color/roughness/clearcoat/SSS channels only affect their intended response. Strong displacement lighting uses screen-space derivatives of the displaced world position rather than the original mesh normal.

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

## GLTF bundles

For an external-resource GLTF, select the `.gltf`, referenced `.bin` files and textures together. Relative resources are resolved from that explicit selection and never fetched from the network. Missing or ambiguous resources fail with an explicit error.

## Rendering notes

The SSS layer is a realtime raster approximation intended for interactive biological-material authoring. It is not path-traced volumetric scattering. Wet-film layers modulate the physical clearcoat response per pixel. Displaced normals are reconstructed from screen-space derivatives, which is robust for arbitrary imported topology but remains a raster approximation at silhouettes and discontinuities.

## Verification

GitHub Actions installs dependencies and runs `npm run build` on pushes to `main` and pull requests. Local verification uses the same command.

## Roadmap

See [`docs/PLAN.md`](docs/PLAN.md). Phase 1 and Phase 2 are implemented. Phase 3 focuses on texture/height/normal baking, optimized GLB export, thumbnails and performance tooling.
