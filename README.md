# Procedural Texture Lab

A realtime Three.js material playground for building layered procedural surfaces, previewing them on 3D meshes, and exporting practical PBR assets.

**Live demo:** [danielsobrado.github.io/procedural-texture-lab](https://danielsobrado.github.io/procedural-texture-lab/)

## V0.1 showcase

![Procedural Texture Lab V0.1 showcase](docs/images/v0-1-showcase.png)

## What it does

- Builds materials from stackable noise, cells, ridges, spots, veins, vessels, wet-film, and subsurface layers
- Supports masks, groups, blend modes, displacement, and physical material controls
- Previews materials on built-in shapes or imported GLB/GLTF meshes
- Includes stone, terrain, grass, moss, and biological presets
- Bakes albedo, roughness, normal, height, clearcoat, and clearcoat-roughness maps
- Exports portable GLB files with baked PBR textures
- Saves and restores projects as JSON

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

## Development

```bash
npm run test:unit
npm run test:browser
npm run test:production-export
npm run test:cross-browser
npm run test:qa
```

The project uses TypeScript, Three.js, Vite, Vitest, and Playwright. Configuration lives in `config/`, while the material compiler, renderer, baker, exporter, and editor UI live under `src/`.

GitHub Pages publishing is manual:

```bash
npm run deploy
```
