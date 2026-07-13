import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist/browser',
    emptyOutDir: false,
    lib: {
      entry: 'src/browser/entry.mts',
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
