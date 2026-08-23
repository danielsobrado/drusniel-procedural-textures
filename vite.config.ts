import { defineConfig, type Plugin } from 'vite';

const WINDOWS_SEPARATOR = String.fromCharCode(92);

// Vite's dev server inlines the optimized-dependency sourcemap as a base64 data URI
// (see the `vite:optimized-deps` load hook feeding `send`). For `three/webgpu` that
// turns a 1.9 MB chunk into a 6.2 MB response, and the app pulls three such chunks.
// Returning an empty-mappings map for anything under `.vite/deps` suppresses the
// inlining. App sources keep their own sourcemaps, so debugging is unaffected.
function stripOptimizedDepSourcemaps(): Plugin {
  return {
    name: 'ptl:strip-optimized-dep-sourcemaps',
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      const normalized = id.split(WINDOWS_SEPARATOR).join('/');
      if (!normalized.includes('/.vite/deps/')) return null;
      return { code, map: { mappings: '' } };
    }
  };
}

// three 0.185 ships `build/three.module.js` and `build/three.webgpu.js` that BOTH
// re-export from `./three.core.js`, so the core classes are already shared between
// the `three` and `three/webgpu` entry points. Aliasing them to `three/src/*` (as we
// did previously) forced Vite to pre-bundle ~750 individual source modules for no gain.
// `dedupe` is the safety net against a nested copy.
export default defineConfig({
  base: './',
  plugins: [stripOptimizedDepSourcemaps()],
  resolve: {
    dedupe: ['three']
  },
  optimizeDeps: {
    include: ['three', 'three/webgpu', 'three/tsl']
  }
});
