# @drusniel/ptl-runtime

Portable Procedural Texture Lab materials for Three.js. The package loads versioned `.ptl.json` recipes, prepares simulation and texture-field dependencies, and applies the resulting material to a mesh without bundling the Lab editor.

## Install

```bash
npm install @drusniel/ptl-runtime three
```

Three.js is a peer dependency. V0.3.0 supports Three.js `>=0.185.0 <0.186.0`.

## Quick start

```ts
import * as THREE from 'three';
import {
  loadMaterialRecipe,
  ProceduralMaterial
} from '@drusniel/ptl-runtime';

const recipe = await loadMaterialRecipe('/materials/brick.ptl.json');
const procedural = new ProceduralMaterial(recipe, {
  coordinateSpace: 'object'
});

await procedural.prepare();

const mesh = new THREE.Mesh(new THREE.BoxGeometry());
procedural.applyTo(mesh);

// Later, with the rest of the mesh resources:
procedural.dispose();
```

Call `prepare()` before the first render and again after changing the seed when the recipe contains simulation-backed layers. Call `dispose()` when the material is no longer used.

## Renderer backends

The default backend is `webgpu`, which creates a TSL node material for `WebGPURenderer`. Three.js can run that renderer through its WebGL2 backend when WebGPU is unavailable.

Use the compatibility backend with the classic `WebGLRenderer`:

```ts
const procedural = new ProceduralMaterial(recipe, {
  backend: 'webgl'
});
```

The WebGL compatibility backend also assigns matching custom depth and distance materials when `applyTo()` is called, so displaced geometry casts consistent shadows.

## Coordinate space

- `object` keeps a procedural pattern attached to a moving mesh.
- `world` keeps the material aligned to the world, which is useful for terrain and shared architectural surfaces.

The recipe's coordinate space is used by default. Override it in the constructor or later:

```ts
procedural.setCoordinateSpace('world');
procedural.setCoordinateSpace(null); // Return to the recipe setting.
```

## Variants and live changes

```ts
procedural.setSeed(93771);
await procedural.prepare();

procedural.setWireframe(true);
procedural.setRecipe(anotherRecipe);
await procedural.prepare();
```

Seeds produce deterministic variants of the same material family. `setRecipe()` validates and normalizes its input before updating the material.

## Texture fields

Texture-bearing recipes declare stable field IDs such as `perlin.01`. By default, the runtime generates deterministic tileable fields in code, so a recipe does not require an asset installation:

```ts
const procedural = new ProceduralMaterial(recipe, {
  textureFieldSource: 'generated',
  generatedTextureFields: { resolution: 256 }
});
```

For exact Lab fidelity, host the PTL KTX2 catalog and supply a resolver owned by your application:

```ts
import type {
  ResolvedTextureField,
  TextureResolver
} from '@drusniel/ptl-runtime';

const resolver: TextureResolver = {
  async resolve(id): Promise<ResolvedTextureField> {
    const field = await loadPackedKtx2Field(id);
    return {
      texture: field.texture,
      channel: field.channel
    };
  },
  release(id, texture) {
    releasePackedKtx2Field(id, texture);
  }
};

const procedural = new ProceduralMaterial(recipe, {
  textureFieldSource: 'external',
  textureResolver: resolver
});
```

The host owns externally resolved textures. The runtime calls the optional `release()` hook when a dependency is replaced or the procedural material is disposed.

With `textureFieldSource: 'auto'`, a supplied resolver is preferred and generated fields are used when no resolver is supplied.

## Surface graphs

Version-3 recipes can preserve an authored Surface Designer graph. Exposed values can be changed and compiled without flattening the graph:

```ts
import {
  compileSurfaceGraph,
  setSurfaceGraphExposedValue
} from '@drusniel/ptl-runtime';

if (recipe.surfaceGraph) {
  const graph = setSurfaceGraphExposedValue(
    recipe.surfaceGraph,
    'mortar-gap',
    0.12
  );
  const compiled = compileSurfaceGraph(graph);
  console.log(compiled.layers);
}
```

## Recipe compatibility

`parseMaterialRecipe()` accepts recipe versions 1, 2, and 3. Older recipes migrate to the current in-memory representation. Texture-field dependencies require version 3.

Useful recipe APIs include:

- `createMaterialRecipe()`
- `loadMaterialRecipe()`
- `parseMaterialRecipe()`
- `serializeMaterialRecipe()`
- `PTL_MATERIAL_FORMAT`, `PTL_MATERIAL_VERSION`, and `PTL_MATERIAL_FILE_SUFFIX`

## License

Apache-2.0. Three.js remains external and is provided by the host application.
