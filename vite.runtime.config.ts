import { defineConfig } from 'vite';

export default defineConfig({
  // The runtime is code only. Without this the Lab's models, textures and thumbnails are
  // copied beside it and shipped to every consumer.
  publicDir: false,
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
    lib: {
      entry: 'src/runtime/index.ts',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: (id) => id === 'three' || id.startsWith('three/')
    }
  }
});
