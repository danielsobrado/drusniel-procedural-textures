# Texture library

The version 2 catalog in `config/texture-library.yaml` maps 117 stable scalar field IDs to 41 RGBA-packed KTX2 files. Stable IDs used by Material Recipes did not change.

## Encoding policy

- Referenced packs listed by the catalog are generated at 1024×1024.
- Long-tail packs are generated at 512×512.
- Each file contains up to four independent scalar fields in R, G, B, and A.
- Files use UASTC encoding, Zstandard supercompression, and a complete mip chain.
- The encoded library must remain within the catalog's 48 MiB budget.

`npm run prepare:textures` validates every KTX2 header, dimensions, UASTC/Zstd mode, catalog/file parity, packed-slot uniqueness, and total bytes. It also synchronizes the Three.js Basis transcoder files.

## Reproducible source and provenance

The raster source is deterministic code rather than an untracked source-image archive. `scripts/generate-texture-library.mjs` derives every field from its stable ID, creates periodic high-resolution RGBA source data, stages all encoded results, checks the byte budget, and only then replaces the public KTX2 set.

Regenerate with Khronos KTX-Software `toktx` 4.4.2 available on `PATH`:

```bash
npm run textures:generate
npm run prepare:textures
```

The generator uses single-threaded deterministic UASTC RDO at quality 2 and Zstandard level 18. Catalog metadata names both the generator and encoder so release artifacts remain auditable.

## License

The generator and all outputs it deterministically creates are original project assets covered by the repository's Apache License 2.0. Every catalog entry records:

```text
provenance: deterministic-project-generator-v1
license: Apache-2.0
source: scripts/generate-texture-library.mjs
```

The previous unknown-provenance ETC1S files are not part of the version 2 library.

## Runtime Package integration

The Runtime Package is self-contained by default: when no `TextureResolver` is supplied, it generates deterministic periodic scalar fields for the built-in catalog families. Generated fields need no asset server or transcoder and support all texture-field modes, but they approximate the catalog at a configurable 32–512 resolution. Unknown custom families require a resolver unless `allowUnknownFamilies` is explicitly enabled. Consumers that persist generated output should record `PTL_GENERATED_TEXTURE_FIELD_VERSION` with the runtime version and selected resolution.

For exact Lab fidelity, the Runtime Package accepts either a bare Three.js texture or `{ texture, channel }` from `TextureResolver.resolve()`. Catalog-backed resolvers cache by packed file and return the physical channel for the requested stable ID. This lets Material Recipes keep their stable IDs and logical channel data while using the packed library correctly.

The KTX2 bytes are not embedded in the npm tarball. They are Apache-2.0 and may be hosted or packaged separately; exclusion keeps the Runtime Package small and leaves asset URL and renderer-support setup with the host application. Use `textureFieldSource: 'external'` to require them, or the default `auto` policy to use a resolver when present and generated fields otherwise.
