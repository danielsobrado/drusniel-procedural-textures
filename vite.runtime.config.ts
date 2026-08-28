import { defineConfig } from 'vite';

export default defineConfig({
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
