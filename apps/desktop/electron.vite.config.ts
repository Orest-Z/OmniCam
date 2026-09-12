import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    // Root is src/ so both renderer/ and engine/ pages are inside it.
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        // Two renderer entry points: the visible UI and the hidden media engine.
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          engine: resolve(__dirname, 'src/engine/index.html'),
        },
      },
    },
  },
});
