# Procedural Texture Lab — Implementation Plan

## Product goal

Build a professional realtime procedural material laboratory in Three.js for authoring, combining, previewing, and exporting layered materials across procedural preview meshes and imported GLB/GLTF assets.

## Phase 1 — Foundation

Implemented.

- Compact professional desktop/tablet/mobile shell.
- Object/material library, inspector, realtime viewport, layer dock, and radial quick actions.
- Procedural sphere, icosphere, cube, rounded cube, torus, and plane previews.
- GLB and self-contained GLTF import.
- Layer stack with Base, FBM, Cellular, Ridges, Spots, Veins, and Gradient.
- Blend modes, layer opacity/scale/strength/seed/colors/roughness/displacement, reorder, enable/disable.
- Physical surface settings, presets, undo/redo, project JSON, autosave, wireframe, and PNG preview capture.
- YAML-driven runtime/editor configuration.

## Phase 2 — Advanced authoring

Implemented.

- Layer output channels for surface/color/roughness/height/clearcoat/SSS.
- Procedural masks with strength and inversion.
- Nested material groups with inherited enable/opacity.
- Biological SSS approximation and wet-film clearcoat layers.
- Branching vessel generator.
- Displacement-aware surface normals and coherent depth/distance shadow displacement.
- Environment library with studio presets and custom HDR import.
- Per-mesh material assignment for imported models.
- Multi-file GLTF bundles with local external resources.

## Phase 3 — Production output

Implemented.

### Texture baking

- Bake albedo, roughness, tangent-space normal, height, clearcoat, and clearcoat roughness.
- Use the same procedural fields, masks, groups, channel routing, and displacement model as realtime rendering.
- Snapshot bake uniforms/material state before asynchronous export work.
- Support current morph/skinning-deformed source geometry where available.
- Dilate UV-island borders to reduce filtering seams.
- Reject missing, non-finite, tiled/out-of-range, overlapping, or mirrored UV layouts instead of producing ambiguous maps.

### GLB export

- Export binary glTF with conventional baked PBR maps.
- Keep imported meshes that are not assigned to the procedural lab material on their original materials.
- Remove preview-only normalization from imported assets so source hierarchy, origin, scale, and transforms are preserved.
- Snapshot physical settings, mesh assignments, displacement extent, and procedural bake uniforms once for the complete multi-mesh export.
- Preserve transmission/thickness/attenuation when representable by standard Three.js/glTF export.
- Approximate realtime biological SSS by conservatively folding its color contribution into baked albedo because standard glTF has no direct SSS material model.

### Asset robustness

- Resolve external GLTF bundle URIs relative to the primary GLTF directory before basename fallback.
- Reject remote resources, missing files, and ambiguous bundle matches.

### Presets and performance

- Searchable/tagged preset browser with GPU-rendered thumbnails.
- FPS, frame time, draw calls, triangles, geometry count, and texture count.
- Auto/Mobile/Balanced/High/Ultra quality tiers controlling viewport DPR, shadow resolution, bake resolution, and GLB texture limits.
- Bake/GLB actions exposed in the two-ring radial menu for narrow/mobile layouts.

## Acceptance criteria

Phase 3 implementation is functionally complete when:

1. An eligible uniquely unwrapped mesh can bake the six production texture maps.
2. Unsupported UV layouts fail explicitly with actionable guidance.
3. An imported model exported from the lab retains its original source transforms rather than preview normalization.
4. A multi-mesh export uses one immutable procedural/material snapshot from start to finish.
5. Unassigned imported meshes retain their source materials in the GLB.
6. External GLTF bundle paths resolve correctly relative to the primary file.
7. Biological SSS loss during standard glTF export is explicitly approximated/documented rather than silently discarded.
8. Mobile users can reach Bake and GLB export from the radial menu.
9. Quality tiers influence viewport and production output budgets through YAML-backed configuration.
10. TypeScript/Vite production build remains green.

## Remaining verification work

- Add a real browser/WebGL smoke suite that compiles the injected procedural shaders.
- Bake a deterministic fixture and verify non-empty/aligned maps.
- Export and reload a fixture GLB to verify transforms, materials, and texture bindings round-trip correctly.
- Expand compatibility testing across skinned, morphed, multi-material, and unusually nested production assets.
