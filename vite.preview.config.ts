import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';

// Single-file build for the hosted Claude preview: everything inline, in-memory routing.
export default mergeConfig(
  base,
  defineConfig({
    plugins: [viteSingleFile()],
    define: { 'import.meta.env.VITE_PREVIEW_HOST': JSON.stringify('1') },
    build: { outDir: 'dist-preview', copyPublicDir: false },
    resolve: { alias: [{ find: /^firebase\/.*$/, replacement: new URL('./preview-stubs/firebase.ts', import.meta.url).pathname }] },
  }),
);
