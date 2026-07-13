import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  if (mode === 'server') {
    return {
      ssr: { noExternal: true },
      build: {
        emptyOutDir: false,
        outDir: 'dist',
        ssr: 'src/server.mts',
        rollupOptions: {
          output: {
            entryFileNames: 'server.mjs',
            chunkFileNames: 'server/[name]-[hash].mjs'
          }
        }
      }
    };
  }
  return {
    build: {
      emptyOutDir: false,
      outDir: 'dist/browser',
      lib: { entry: 'src/browser/entry.mts', formats: ['es'], fileName: () => 'entry.mjs' }
    }
  };
});
