import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const here = (file) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig(({ mode }) => ({
  root: here('./src'),
  base: '/',
  plugins: [svelte()],
  logLevel: 'warn',
  build: {
    outDir: process.env.AEL_STUDIO_OUT || here('./app'),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1200
  }
}));
