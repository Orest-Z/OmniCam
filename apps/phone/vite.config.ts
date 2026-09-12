import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The phone page is served by the desktop app from its resources folder.
export default defineConfig({
  base: './',
  build: {
    outDir: resolve(__dirname, '../desktop/resources/phone'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // stable names so the desktop static server can be trivially simple
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
  server: {
    // dev only: allows testing the page from a phone against a running desktop app
    host: true,
  },
});
