import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { generateNotices } from './generate-notices.mjs';

const root = path.resolve(import.meta.dirname, '..');
const external = (id) => id.startsWith('node:') || id.startsWith('@agentcanvas/');

const result = await build({
  root,
  configFile: false,
  ssr: { noExternal: true },
  build: {
    target: 'node24',
    ssr: path.join(root, 'src/server.mts'),
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      external,
      output: {
        entryFileNames: 'server.mjs',
        chunkFileNames: 'server/[name]-[hash].mjs'
      }
    }
  }
});

function packageJsonForModule(id) {
  if (!path.isAbsolute(id) || !fs.existsSync(id)) return undefined;
  for (let directory = path.dirname(id); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') return candidate;
    }
    if (path.dirname(directory) === directory) return undefined;
  }
}

const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output);
const packageJsonFiles = new Set();
for (const chunk of outputs) {
  if (chunk.type !== 'chunk') continue;
  for (const id of Object.keys(chunk.modules)) {
    const packageJson = packageJsonForModule(id);
    if (packageJson && path.resolve(packageJson) !== path.resolve(root, 'package.json')) packageJsonFiles.add(packageJson);
  }
}

await generateNotices(packageJsonFiles, process.argv.includes('--check-notices'));
