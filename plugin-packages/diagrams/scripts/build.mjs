import { build } from 'vite';
import { copyFile, mkdir } from 'node:fs/promises';
const external = id => id.startsWith('node:') || id.startsWith('@agentcanvas/') || id === 'playwright';
await build({ configFile: false, ssr: {noExternal: true}, build: { target: 'node24', ssr: 'src/server.mts', outDir: 'dist', emptyOutDir: false, rollupOptions: { external, output: { entryFileNames: 'server.mjs' } } } });
await build({ configFile: false, build: { target: 'es2022', outDir: 'dist/browser', emptyOutDir: true, lib: { entry: 'src/browser/entry.mts', formats: ['es'], fileName: () => 'entry.mjs' }, rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].mjs' } } } });
await build({ configFile: false, build: { target: 'es2022', outDir: 'dist/headless', emptyOutDir: true, lib: { entry: 'src/mermaid/headless-entry.ts', name: 'AgentCanvasDiagramsEngine', formats: ['iife'], fileName: () => 'engine.js' }, rollupOptions: { output: { inlineDynamicImports: true } } } });
await mkdir('dist/mermaid/headless', { recursive: true });
await copyFile('dist/headless/engine.js', 'dist/mermaid/headless/engine.js');
