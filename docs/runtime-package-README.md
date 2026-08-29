# PTL Runtime

Portable, deterministic procedural materials exported by Procedural Texture Lab for Three.js.

> Status: stable V0.3. The runtime package is staged as `@drusniel/ptl-runtime` and licensed under Apache-2.0. Recipe compatibility is versioned independently from the npm package version.

## What the package is

PTL Runtime is the reusable material engine behind Procedural Texture Lab. The Lab is the authoring application; the runtime is the package a game, configurator, viewer, or other Three.js application can use to regenerate exported PTL materials.

```text
Procedural Texture Lab
        |
        | Export PTL
        v
  material.ptl.json
        |
        v
@drusniel/ptl-runtime
        |
        +-- procedural layers
        +-- surface graph
        +-- deterministic seed
        +-- simulations
        +-- generated or external texture fields
        |
        v
   Three.js material
```

The npm package contains runtime JavaScript, TypeScript declarations, and a deterministic code-only texture-field generator. It intentionally does not contain the Lab UI, project/editor state, texture baker, GLB exporter, Tile Lab, the high-fidelity KTX2 library, or its own copy of Three.js.

## License

`@drusniel/ptl-runtime` is licensed under the Apache License 2.0. The repository root `LICENSE` file is copied into the staged npm package during `npm run build:runtime-package`.

The code-generated fallback and Lab KTX2 texture-field assets are licensed under Apache-2.0. The KTX2 bytes are not embedded in this npm package; applications may host them separately for exact Lab fidelity.

## Installation

```bash
npm install @drusniel/ptl-runtime three@0.185
```

V0.3 declares this Three.js peer range:

```text
>=0.185.0 <0.186.0
```

Three.js is a peer dependency so the host application and PTL use the same `Texture`, `Material`, `Mesh`, and renderer ecosystem.

### Texture-field installation profiles

One npm installation supports three deployment profiles:

| Profile | Runtime option | External assets | Intended use |
|---|---|---:|---|
| Automatic, default | `textureFieldSource: 'auto'` | Optional | Uses a supplied resolver, otherwise generates fields in-process |
| Code-only | `textureFieldSource: 'generated'` | No | Offline demos, prototypes, tests, and compact deployments |
| Full fidelity | `textureFieldSource: 'external'` plus `textureResolver` | Yes | Production parity with the Lab’s packed KTX2 catalog |

Generated fields are periodic, deterministic, mipmapped scalar textures derived from supported PTL catalog dependency IDs. They preserve `replace`, `modulate`, `warp`, and `detail` behavior without a network request or transcoder. They approximate each field family; the separately hosted KTX2 catalog is recommended when exact authored pixels, higher resolution, channel packing, and avoiding runtime CPU generation matter. Unknown host-specific families fail by default so a missing custom asset cannot silently become generic noise; set `generatedTextureFields.allowUnknownFamilies` only when that approximation is intentional.

To build and test the exact package from this repository without publishing:

```bash
npm run test:runtime-package
```

That command builds the runtime package and installs it into a clean external TypeScript consumer test.

## Quick start

```ts
import {
  loadMaterialRecipe,
  ProceduralMaterial
} from '@drusniel/ptl-runtime';

const recipe = await loadMaterialRecipe('/materials/stone.ptl.json');
const procedural = new ProceduralMaterial(recipe);

await procedural.prepare();
procedural.applyTo(mesh);

procedural.dispose();
```

Call `prepare()` before first render. Pure analytic materials complete immediately; simulation-backed and texture-bearing materials hydrate their required runtime data there. With no resolver, texture-bearing recipes use the generated code-only source automatically.

To force a smaller self-contained field size:

```ts
const procedural = new ProceduralMaterial(recipe, {
  textureFieldSource: 'generated',
  generatedTextureFields: { resolution: 128 }
});
```

The default generated resolution is 256. Supported values are powers of two from 32 through 512.

## Renderer backends

### WebGPU / TSL — default

```ts
const procedural = new ProceduralMaterial(recipe);
```

The default backend is `webgpu`. It selects the Three.js node-material/TSL path intended for `WebGPURenderer`.

Three.js can run `WebGPURenderer` through its WebGL2 backend when native WebGPU is unavailable. That remains the PTL TSL path and is different from the classic `WebGLRenderer` API.

### Classic WebGLRenderer compatibility

Applications using the classic `WebGLRenderer` must request the compatibility backend explicitly:

```ts
const procedural = new ProceduralMaterial(recipe, {
  backend: 'webgl'
});
```

For this backend `applyTo()` also assigns compatible custom depth and distance materials so procedural vertex displacement is represented in shadow passes.

## Runtime lifecycle

```ts
const procedural = new ProceduralMaterial(recipe, options);

await procedural.prepare();
procedural.applyTo(mesh);

procedural.setSeed(93771);
await procedural.prepare();

procedural.dispose();
```

`ProceduralMaterial` exposes:

- `material`: the Three.js material produced by the selected backend.
- `recipe`: a normalized copy of the current recipe.
- `seed`: the current recipe seed.
- `backend`: `webgpu` or `webgl`.
- `textureFieldSource`: the selected `generated` or `external` source after `auto` resolution.
- `displacementExtent`: estimated absolute procedural displacement.
- `prepare()`: generates or resolves only the recipe’s required texture fields and builds simulation data.
- `applyTo(mesh)`: installs the runtime material on a `THREE.Mesh`.
- `setRecipe(recipe)`: replaces the recipe and invalidates prepared state.
- `setSeed(seed)`: creates a deterministic variant and invalidates simulation preparation.
- `setCoordinateSpace(space)`: overrides recipe coordinate space.
- `setWireframe(enabled)`: toggles wireframe mode.
- `dispose()`: releases runtime-owned resources and resolver acquisitions.

Do not use a `ProceduralMaterial` after `dispose()`.

## Coordinate space

```ts
type MaterialCoordinateSpace = 'object' | 'world';
```

Use `object` for props and moving objects when the material should stay attached to the mesh:

```ts
const procedural = new ProceduralMaterial(recipe, {
  coordinateSpace: 'object'
});
```

Use `world` for terrain and world-aligned surfaces.

## Deterministic variants

A recipe carries a 32-bit integer seed. PTL derives deterministic per-layer variation from that seed.

```ts
procedural.setSeed(42);
await procedural.prepare();
```

For deterministic reproduction preserve:

- the normalized PTL recipe;
- the recipe seed;
- compatible recipe and algorithm versions;
- `PTL_GENERATED_TEXTURE_FIELD_VERSION` when using generated fields;
- the generated-field resolution, or the same external texture bytes for every stable dependency id.

Changing the external bytes behind a stable id such as `rock.01` changes the material even when the recipe and seed are unchanged. Published texture ids should therefore be immutable. The generated source is deterministic for a given runtime algorithm version, dependency ID, and resolution.

## Material Recipes

PTL recipes use:

```text
format: ptl-material
current recipe version: 4
```

Portable recipe state includes:

```text
format
version
seed
coordinateSpace
algorithms
physical
synthesis
groups
layers
surfaceGraph
dependencies
```

Lab viewport state, selection, history, and other authoring-only state are excluded.

Current compatibility rules:

- Recipe v1 is accepted and migrated in memory.
- Recipe v2 adds portable surface graphs and is accepted and migrated in memory.
- Recipe v3 adds versioned texture-field dependencies.
- Texture fields require recipe v3 so older runtimes cannot silently render a different material.

Use the exported parsers for external JSON:

```ts
import {
  parseMaterialRecipe,
  serializeMaterialRecipe
} from '@drusniel/ptl-runtime';

const normalized = parseMaterialRecipe(untrustedJson);
const json = serializeMaterialRecipe(normalized);
```

To create a recipe from portable runtime state:

```ts
import {
  createMaterialRecipe,
  type RuntimeMaterialDefinition
} from '@drusniel/ptl-runtime';

const definition: RuntimeMaterialDefinition = {
  physical,
  synthesis,
  groups,
  layers,
  surfaceGraph
};

const recipe = createMaterialRecipe(definition, 42, 'object');
```

## External texture fields

PTL can combine mathematical procedural generation with small external scalar texture fields. This is how the newer noise/structure textures in the Lab work with the reusable runtime.

The texture bytes are not embedded in `.ptl.json` and are not bundled in `@drusniel/ptl-runtime`. A layer stores a stable texture id plus field-transform settings. Recipe v3 declares referenced ids under `recipe.dependencies.textures`.

Example:

```json
{
  "format": "ptl-material",
  "version": 4,
  "layers": [
    {
      "id": "stone-structure",
      "texture": {
        "id": "rock.01",
        "scaleX": 3,
        "scaleY": 3,
        "rotation": 0,
        "offsetX": 0,
        "offsetY": 0,
        "contrast": 1.2,
        "bias": 0,
        "invert": false,
        "clamp": true,
        "channel": "r"
      }
    }
  ],
  "dependencies": {
    "textures": [
      {
        "id": "rock.01",
        "version": 1
      }
    ]
  }
}
```

The parser derives and validates texture dependencies from normalized material layers.

### TextureFieldSettings

```ts
interface TextureFieldSettings {
  id: string;
  scaleX: number;
  scaleY: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  contrast: number;
  bias: number;
  invert: boolean;
  clamp: boolean;
  channel: 'r' | 'g' | 'b' | 'a' | 'luminance';
}
```

The WebGPU/TSL path treats the resolved texture as a scalar procedural field. It transforms the sampling domain, samples the selected channel, applies contrast/bias/inversion/clamping, and combines the result with the procedural layer system.

Texture fields are sampled across XY, XZ, and YZ projections and averaged, so they behave as triplanar spatial fields rather than normal UV-wrapped final textures.

### Hybrid materials

A texture field can provide structure that procedural layers reuse for color, height, roughness, masks, weathering, and other channels.

```text
rock.01 external field
       |
       +--> structure source --> FBM detail --> height
       |
       +--> mask source -------> roughness breakup
       |
       +--> color shaping -----> stone variation
```

A field-source layer may be hidden as a visible layer and still be required by an enabled consumer through `maskSourceLayerId` or `structureSourceLayerId`. The runtime follows that dependency graph and resolves required texture ids transitively.

## Texture-field sources

The default `auto` source makes texture-bearing Material Recipes self-contained:

```ts
const procedural = new ProceduralMaterial(recipe);
await procedural.prepare();
```

No texture asset, URL, KTX2 transcoder, or resolver is needed. The package exports `GeneratedTextureResolver` for applications that want to manage a generated resolver explicitly, but `ProceduralMaterial` creates and owns the normal default automatically.

Set `textureFieldSource: 'external'` when missing production assets should be treated as an error. Passing `textureResolver` with the default `auto` policy also selects the external path automatically.

### TextureResolver

Externally loaded textures are owned by the host application. PTL defines this optional boundary:

```ts
import type { Texture } from 'three';

type TextureFieldChannel = 'r' | 'g' | 'b' | 'a' | 'luminance';

interface ResolvedTextureField {
  texture: Texture;
  channel?: TextureFieldChannel;
}

interface TextureResolver {
  resolve(id: string): Promise<Texture | ResolvedTextureField>;
  release?(id: string, texture: Texture): void;
}
```

Example:

```ts
import {
  ProceduralMaterial,
  type TextureResolver
} from '@drusniel/ptl-runtime';

const textureResolver: TextureResolver = {
  resolve: async (id) => textureManager.load(id),
  release: (id, texture) => textureManager.release(id, texture)
};

const procedural = new ProceduralMaterial(recipe, {
  textureFieldSource: 'external',
  textureResolver
});

await procedural.prepare();
```

`resolve()` may return a bare `THREE.Texture` or `{ texture, channel }` for the requested stable id. The descriptor form lets several stable IDs share one RGBA-packed GPU texture. Its physical channel overrides the Material Recipe's logical channel without changing the recipe, so older recipes remain compatible. `prepare()` asks only for transitive IDs required by enabled recipe layers.

`release()` is optional. It is useful for reference-counted asset systems and may be a no-op for an application-level cache.

PTL does not dispose host textures directly. Ownership stays behind the resolver boundary.

For one material instance:

- `prepare()` reuses already-resolved ids.
- `setSeed()` retains unchanged external textures.
- `setRecipe()` releases resolver acquisitions from the previous recipe.
- `dispose()` releases resolver acquisitions through `release()` when provided.
- failed or superseded asynchronous preparation releases newly acquired textures.

## KTX2 / Basis — recommended full-fidelity option

The Lab stores its texture-field library as RGBA-packed UASTC/Zstd KTX2 assets. They are recommended for production fidelity but are not required by the runtime. Any loader is valid if the resolver returns a configured `THREE.Texture` or packed-field descriptor.

```ts
import * as THREE from 'three';
import type { TextureResolver } from '@drusniel/ptl-runtime';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const catalog = {
  'rock.01': { url: '/assets/ptl/rock-pack-01.ktx2', channel: 'r' },
  'cracks.01': { url: '/assets/ptl/cracks-pack-01.ktx2', channel: 'r' },
  'cracks.03': { url: '/assets/ptl/cracks-pack-01.ktx2', channel: 'b' }
} as const;

const loadFile = (url: string): Promise<THREE.Texture> => {
  const existing = fileCache.get(url);
  if (existing !== undefined) return existing;
  const pending = ktx2Loader.loadAsync(url).then((texture) => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  });
  fileCache.set(url, pending);
  return pending;
};

const ktx2Loader = new KTX2Loader();
const fileCache = new Map<string, Promise<THREE.Texture>>();

const textureResolver: TextureResolver = {
  async resolve(id) {
    const entry = catalog[id as keyof typeof catalog];
    if (entry === undefined) throw new Error(`Unknown PTL texture dependency: ${id}`);
    return { texture: await loadFile(entry.url), channel: entry.channel };
  },
  release() {
    // Keep the application-level cache alive.
  }
};

const procedural = new ProceduralMaterial(recipe, {
  textureFieldSource: 'external',
  textureResolver
});
```

Configure `KTX2Loader.setTranscoderPath()` and `detectSupport()` in the host before using the resolver.

## Lab texture library versus npm runtime

The Lab field catalog includes families such as `cracks`, `marble`, `perlin`, `rock`, `stone`, `vein`, and `voronoi`.

```text
@drusniel/ptl-runtime
  Apache-2.0 code, types, algorithms, graph, simulations
  deterministic generated texture fields (no asset requests)

Lab/host texture assets
  Apache-2.0 KTX2/PNG/etc. bytes addressed by stable dependency id
  hosted separately from the code-only npm tarball
```

The current Lab catalog records `deterministic-project-generator-v1` provenance and Apache-2.0 licensing for every field. The runtime package deliberately excludes the KTX2 bytes for package-size and host-deployment reasons, not rights restrictions. Packed resolvers must return the catalog's physical channel as shown above. Without them, the generated source keeps the recipe functional but is not pixel-identical to the Lab assets.

## Simulation-backed materials

Reaction-diffusion and erosion are prepared through the runtime compute engine and packed into a simulation atlas used by the material compiler.

```ts
const procedural = new ProceduralMaterial(recipe);
await procedural.prepare();
```

PTL uses WebGPU compute where implemented and bounded CPU fallbacks when needed.

Changing the recipe or seed invalidates simulation preparation. Call `prepare()` again after those changes.

## Surface graphs

Recipe v2 and later can preserve the authored PTL surface graph.

```ts
import {
  compileSurfaceGraph,
  setSurfaceGraphExposedValue
} from '@drusniel/ptl-runtime';

if (recipe.surfaceGraph !== null) {
  const graph = setSurfaceGraphExposedValue(
    recipe.surfaceGraph,
    'mortar-gap',
    0.12
  );

  const compiled = compileSurfaceGraph(graph);
  console.log(compiled.layers);
}
```

Use `normalizeSurfaceGraph()` when you need normalized graph structure without compiling it. Use `compileSurfaceGraph()` or `parseMaterialRecipe()` at an execution boundary; they also validate PBR output ports, output types, material-output cardinality, and explicit output-route consistency.

## Public API

### Recipes

- `createMaterialRecipe()`
- `loadMaterialRecipe()`
- `parseMaterialRecipe()`
- `serializeMaterialRecipe()`
- `PTL_MATERIAL_FORMAT`
- `PTL_MATERIAL_VERSION`
- `PTL_MATERIAL_FILE_SUFFIX`
- recipe and dependency types

### Runtime material

- `ProceduralMaterial`
- `ProceduralMaterialBackend`
- `ProceduralMaterialOptions`
- `TextureFieldSource`
- `GeneratedTextureResolver`
- `GeneratedTextureResolverOptions`
- `PTL_GENERATED_TEXTURE_FIELD_FAMILIES`
- `PTL_GENERATED_TEXTURE_FIELD_VERSION`
- `TextureResolver`
- `ResolvedTextureField`
- `TextureFieldResource`

### Runtime material data

- `RuntimeMaterialDefinition`
- `MaterialLayer`
- `MaterialGroup`
- `PhysicalSettings`
- `SynthesisSettings`
- `LayerKind`
- `LayerChannel`
- `BlendMode`
- `MaterialCoordinateSpace`

### Texture fields

- `DEFAULT_TEXTURE_FIELD_SETTINGS`
- `TEXTURE_FIELD_CHANNELS`
- `TextureFieldSettings`
- `TextureFieldChannel`

### Algorithms and graph

- `PTL_ALGORITHM_VERSION`
- `MaterialAlgorithmSettings`
- `normalizeSurfaceGraph()`
- `setSurfaceGraphExposedValue()`
- `compileSurfaceGraph()`
- exported surface-graph types

The package intentionally does not expose Lab/editor classes as public runtime APIs.

## Error handling

Treat recipe loading and preparation as normal asynchronous failure points:

```ts
try {
  const recipe = await loadMaterialRecipe('/materials/cliff.ptl.json');
  const procedural = new ProceduralMaterial(recipe, { textureResolver });
  await procedural.prepare();
  procedural.applyTo(mesh);
} catch (error) {
  console.error('Could not prepare PTL material.', error);
}
```

Typical failures include invalid recipe data, unsupported versions, an external-only policy without a resolver, unknown external dependency ids, loader failures, renderer/backend mismatch, and use after disposal.

The strict `external` policy fails on missing texture dependencies instead of silently switching to generated fields. The default `auto` policy chooses its source at construction: a supplied resolver remains authoritative, while no resolver selects deterministic generation.

## Package boundaries

The staged runtime package is checked so editor-only dependencies do not leak into the npm artifact.

It must not contain Lab-only concepts such as:

- `ProjectState`;
- `TextureBaker`;
- GLB export code;
- Tile Lab;
- editor YAML loaded through Vite `?raw` imports;
- the Lab texture catalog;
- the `yaml` runtime dependency.

Generated portable runtime configuration is allowed; editor configuration itself is not.

## Building and testing

The Lab root package stays private.

```bash
npm run build:runtime
npm run build:runtime-package
npm run test:runtime-package
```

The staged npm package is written to:

```text
dist-runtime-package/
```

It contains the compiled ES module, TypeScript declarations, this README, generated package metadata, and the Apache-2.0 `LICENSE` file.

The package builder checks size budgets and forbidden Lab markers. The consumer test installs the staged package into a clean external TypeScript project rather than importing Lab source files.

The normal CI command also builds and validates the runtime package:

```bash
npm run ci
```

## Publishing

Runtime publication is manual and independent from GitHub Pages deployment.

```bash
npm run publish:runtime
```

Publication is enabled in `config/runtime-package.yaml` with:

```yaml
license: "Apache-2.0"
publishable: true
```

The publishing script still requires:

- branch `main`;
- a clean working tree;
- local `main` equal to `origin/main`;
- an authenticated npm account;
- passing project CI;
- a successful npm package dry run.

Pre-release versions containing `-` are published with the `next` dist-tag. Stable versions use `latest`.

Enabling publication does not publish automatically. `npm run publish:runtime` remains an explicit manual release action.

## GitHub Pages is separate

```text
npm run deploy
  -> Lab application to GitHub Pages

npm run publish:runtime
  -> runtime package to npm
```

Neither command implicitly performs the other release.

## Versioning policy

Keep these versions separate:

1. npm package version, for runtime API/library releases;
2. `PTL_MATERIAL_VERSION`, for serialized recipe schema compatibility;
3. `PTL_ALGORITHM_VERSION`, for deterministic procedural algorithm behavior;
4. generated-field resolution or external texture dependency identity/version, for hybrid texture fields.

A runtime package release does not automatically require a recipe-version change. Do not reuse a texture dependency id for different bytes when deterministic reproduction matters.

Older recipes load and are migrated in memory, but a recipe is rejected when it declares a version older than the feature it uses, because the older runtime would render it incorrectly rather than fail:

- a layer with `maskMode: "height"` requires version 4, since a version-3 runtime renders it as a coverage mask;
- a texture-field layer, or a graph containing one, requires version 3.

## Consumer checklist

Before shipping a PTL material in another project:

- install a compatible Three.js version;
- select the correct PTL backend;
- validate the `.ptl.json` recipe;
- call `prepare()` before first use;
- choose and record the generated or external texture-field source;
- for full fidelity, provide a `TextureResolver` and package only the external IDs the material uses;
- keep published texture ids immutable;
- call `dispose()` when the material is no longer needed;
- keep recipe, algorithm, runtime, and asset versions under source control.

## Repository release checklist

Before publishing an npm release:

- confirm the npm scope/name;
- keep the runtime code under Apache-2.0;
- review optional texture-pack redistribution rights separately;
- run `npm run release:check`;
- run `npm run test:runtime-package`;
- inspect `npm pack ./dist-runtime-package --dry-run`;
- publish with `npm run publish:runtime`;
- test installation in a separate Three.js application.
