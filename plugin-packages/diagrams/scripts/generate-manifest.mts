import { writeFile } from 'node:fs/promises';
import { serializeExtensionManifest } from '@agentcanvas/extension-sdk';
import extension from '../src/extension.mjs';
await writeFile(new URL('../agentcanvas.plugin.json', import.meta.url), serializeExtensionManifest(extension));
