import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const threeCore = fileURLToPath(new URL('./node_modules/three/src/Three.js', import.meta.url));
const threeWebGpu = fileURLToPath(new URL('./node_modules/three/src/Three.WebGPU.js', import.meta.url));
const threeTsl = fileURLToPath(new URL('./node_modules/three/src/Three.TSL.js', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      { find: /^three$/, replacement: threeCore },
      { find: /^three\/webgpu$/, replacement: threeWebGpu },
      { find: /^three\/tsl$/, replacement: threeTsl }
    ]
  }
});
