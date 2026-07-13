import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'agentcanvas.plugin.json'), 'utf8'));
const target = join(root, 'plugin-dist', manifest.id);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const path of ['agentcanvas.plugin.json', 'plugin.config.json', 'schemas', 'dist', 'README.md']) {
  await cp(join(root, path), join(target, path), { recursive: true });
}
process.stdout.write(`Packed ${target}\n`);
