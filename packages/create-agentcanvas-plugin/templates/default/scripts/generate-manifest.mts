import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serializeExtensionManifest } from '@agentcanvas/extension-sdk';
import extension from '../src/extension.mjs';

const target = resolve(import.meta.dirname, '..', 'agentcanvas.plugin.json');
await writeFile(target, serializeExtensionManifest(extension), 'utf8');
process.stdout.write(`${target}\n`);
