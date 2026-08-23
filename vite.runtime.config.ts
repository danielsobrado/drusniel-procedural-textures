import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const runtimeConstants = fileURLToPath(new URL('./src/runtime/shims/constants.ts', import.meta.url));
const runtimeCellularConfig = fileURLToPath(new URL('./src/runtime/shims/CellularConfig.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '../app/constants', replacement: runtimeConstants },
      { find: './CellularConfig', replacement: runtimeCellularConfig }
    ]
  },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
    lib: {
      entry: 'src/runtime/index.ts',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: ['three']
    }
  }
});
