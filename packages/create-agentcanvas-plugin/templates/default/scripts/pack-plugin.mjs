import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'agentcanvas.plugin.json'), 'utf8'));
const target = join(root, 'plugin-dist', manifest.id);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const path of ['agentcanvas.plugin.json', 'plugin.config.json', 'schemas', 'dist', 'README.md', 'LICENSE']) {
  await cp(join(root, path), join(target, path), { recursive: true });
}
await writeFile(join(root, 'plugin-dist', 'README.txt'), `${manifest.id} ${manifest.version}\n`, 'utf8');
process.stdout.write(`Packed ${target}\n`);
