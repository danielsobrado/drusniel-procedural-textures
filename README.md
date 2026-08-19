# Procedural Texture Lab

Procedural Texture Lab is a realtime Three.js material-authoring workspace for layered procedural materials, biological surfaces, imported GLB/GLTF models, baking, and portable GLB export.

## Current capabilities

- Compact professional authoring UI with desktop, tablet, and mobile layouts.
- Two-ring radial quick-action menu with keyboard, mouse, and touch long-press access.
- Procedural preview meshes and GLB / GLTF bundle import.
- Layered procedural material system with groups, masks, channel routing, wet-film and biological SSS layers.
- Per-mesh procedural material assignment for imported models.
- Studio environments plus custom HDR environments.
- GPU texture baking for albedo, roughness, tangent-space normal, height, clearcoat, and clearcoat roughness.
- Binary GLB export using conventional baked PBR textures.
- Preset filtering, tags, and rendered material thumbnails.
- Performance profiler and configurable Auto / Mobile / Balanced / High / Ultra quality tiers.
- Project JSON save/open, autosave, undo/redo, PNG preview capture, and keyboard shortcuts.

## Export safety

Production baking deliberately rejects unsupported UV layouts rather than silently producing corrupt maps:

- UV coordinates must be finite and remain inside the 0–1 range.
- UV islands must not overlap or mirror into the same texels.
- Meshes without a valid unique UV set can still use realtime procedural materials, but must be uniquely unwrapped before baking/export.

Imported assets are normalized only for the lab preview. GLB export removes that preview wrapper and preserves the imported model's original hierarchy, scale, origin, and transforms.

A GLB export snapshots the material, physical settings, mesh assignments, displacement extent, and bake uniforms at export start. Editing the lab while a multi-mesh export is running cannot mix different material states in one exported file.

Realtime biological SSS has no direct standard glTF equivalent. Export therefore folds a conservative SSS color contribution into baked albedo while retaining standard transmission/thickness/attenuation settings where applicable. This is an approximation rather than a physically identical SSS round-trip.

## GLTF bundles

For external-resource `.gltf` assets, select the `.gltf`, `.bin`, and referenced image files together. Resource URIs are resolved relative to the primary GLTF directory first, including `../` segments, before any basename fallback. Remote resource URLs remain intentionally unsupported.

## Development

```bash
npm install
npm run build
```

Dependency versions in `package.json` are pinned. CI currently uses `npm install` because the repository does not yet contain a generated `package-lock.json`; once a lockfile is committed, CI should switch to `npm ci`.

The production build runs TypeScript validation and Vite bundling. Browser/WebGL smoke coverage remains the next verification improvement because injected GLSL can only be fully validated by a real graphics context.

## Project phases

### Phase 1 — Lab foundation

Implemented: procedural objects, imported models, layered material authoring, compact inspector/library UI, project persistence, radial commands, and physical-material tuning.

### Phase 2 — Advanced material authoring

Implemented: masks/groups, channel routing, biological SSS and wet-film layers, branching vessels, displacement-aware normals/shadows, environment authoring, per-mesh assignment, and multi-file GLTF bundles.

### Phase 3 — Production output

Implemented: PBR texture baking, UV validation, GLB export, thumbnail browser, performance profiling, quality tiers, and mobile export access.

Remaining verification work is focused on automated browser/WebGL smoke testing, a committed npm lockfile, and wider real-world asset compatibility rather than additional Phase 3 feature scope.
