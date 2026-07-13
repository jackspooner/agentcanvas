import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist/browser',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/browser/entry.ts'),
      formats: ['es'],
      fileName: () => 'entry.mjs'
    },
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].mjs',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
