# Procedural Texture Lab

A realtime Three.js material playground for building layered procedural surfaces, previewing them on 3D meshes, and exporting practical PBR assets.

**Live demo:** [danielsobrado.github.io/procedural-texture-lab](https://danielsobrado.github.io/procedural-texture-lab/)

## V0.2 — Structure, Simulation & Evolution

V0.2 builds coherent materials from shared structural fields instead of treating every PBR channel as an unrelated noise stack. It adds reaction-diffusion and erosion simulations, SDF structures, an advanced dependency graph, environmental ageing, multi-scale synthesis, continuous anti-repetition, and a lockable six-variant material genome.

The renderer keeps broad WebGL compatibility while the simulation layer uses WebGPU for reaction-diffusion where available and a bounded cooperative CPU fallback otherwise. Preview, portable runtime recipes, baking, and GLB export consume the same material and simulation fields.

## V0.1 showcase

![Procedural Texture Lab V0.1 showcase](docs/images/v0-1-showcase.png)

## What it does

- Builds materials from stackable noise, cells, ridges, spots, veins, vessels, wet-film, subsurface, reaction-diffusion, erosion, and SDF layers
- Supports masks, shared structure sources, groups, blend modes, displacement, and physical material controls
- Previews materials on built-in shapes or imported GLB/GLTF meshes
- Includes stone, terrain, grass, moss, and biological presets
- Bakes albedo, roughness, normal, height, clearcoat, clearcoat-roughness, metallic, AO, and emissive maps
- Exports portable GLB files with baked PBR textures
- Exports small `.ptl.json` material algorithms for runtime regeneration
- Saves and restores editor projects as JSON

The editor runs entirely in the browser. Imported models and HDR files stay local and are never fetched from remote URLs.

## Run locally

```bash
npm ci
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

## Controls

| Action | Control |
| --- | --- |
| Orbit | Left drag |
| Pan | Right drag |
| Zoom | Wheel or pinch |
| Frame selection | `F` |
| Wireframe | `W` |
| Radial menu | Right click, `Space`, or touch and hold |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y` |

## Baking and export

Static meshes can receive generated atlas UVs when their source UVs are not safe to bake. Skinned and morph-target meshes keep their topology and need valid source UVs.

GLB export preserves the original hierarchy, transforms, animations, and untouched materials. Procedural layers are converted to standard PBR textures so the result works in regular glTF viewers. Biological subsurface scattering is approximated because glTF has no direct equivalent.

Simulation-backed layers are prepared before texture or GLB export so baked output matches the hydrated editor material instead of silently falling back to the analytic preview approximation.

## Portable runtime materials

Use **Export PTL** to save the authored surface as a small, versioned `.ptl.json` recipe without project-only viewport or imported-asset state. Recipes contain deterministic seeds, coordinate policy, material parameters, and versioned simulation/SDF algorithm settings.

```ts
import { loadMaterialRecipe, ProceduralMaterial } from 'procedural-texture-lab/runtime';

const recipe = await loadMaterialRecipe('/materials/rock.ptl.json');
const procedural = new ProceduralMaterial(recipe, {
  coordinateSpace: 'object'
});

// Hydrates reaction-diffusion and erosion fields when the recipe uses them.
await procedural.prepare();
procedural.applyTo(mesh);
```

Use `coordinateSpace: 'object'` for moving props so the pattern stays attached to the mesh. Use `world` for terrain and world-aligned surfaces. Recipes exported by the editor default to `world` to preserve existing authored output.

For deterministic variants of the same family, change the recipe seed and prepare again when simulation-backed layers are present:

```ts
procedural.setSeed(93771);
await procedural.prepare();
```

`applyTo()` also assigns procedural depth and distance materials so displaced geometry casts matching shadows. Call `procedural.dispose()` with the rest of the mesh resources. Build and verify the standalone ES module with:

```bash
npm run test:runtime-package
```

Three.js remains external to the generated runtime bundle so the host game supplies the shared Three.js instance.

## Development

```bash
npm run test:unit
npm run test:browser
npm run test:runtime-package
npm run test:production-export
npm run test:cross-browser
npm run test:qa
```

The project uses TypeScript, Three.js, Vite, Vitest, and Playwright. Editor configuration lives in `config/`; portable material constraints, recipe algorithms, the material compiler, renderer, baker, exporter, and UI live under `src/`.

CI validates unit tests, the production build, and the standalone runtime package on changes to `main`. GitHub Pages publishing remains manual:

```bash
npm run deploy
```
