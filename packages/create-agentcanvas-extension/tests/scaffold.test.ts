import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldExtension } from '../src/index.js';

const created: string[] = [];
afterEach(async () => Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('create-agentcanvas-extension', () => {
  it('scaffolds the public extension authoring shape', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'agentcanvas-extension-'));
    created.push(parent);
    const target = await scaffoldExtension({ name: 'status-card', cwd: parent });
    const packageJson = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as { name: string };
    expect(packageJson.name).toBe('agentcanvas-extension-status-card');
    expect(await readFile(join(target, 'agentcanvas.plugin.json'), 'utf8')).toContain('"commands"');
  });
});
