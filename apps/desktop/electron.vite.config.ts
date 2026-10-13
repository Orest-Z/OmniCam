import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changelogSection, markdownToHtml } from './build/release-notes';

// "What's new" for the version being built, shown once after an update: its CHANGELOG.md section.
const version = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version;
const releaseNotes = markdownToHtml(changelogSection(readFileSync(resolve(__dirname, '../../CHANGELOG.md'), 'utf8'), version));

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
    define: { __RELEASE_NOTES__: JSON.stringify(releaseNotes) },
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
