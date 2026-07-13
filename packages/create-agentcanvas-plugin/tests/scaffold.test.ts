import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { derivePluginNames, scaffoldPlugin } from '../src/index.js';

const created: string[] = [];
afterEach(async () => Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('create-agentcanvas-plugin', () => {
  it('derives stable public identifiers', () => {
    expect(derivePluginNames('hello-card')).toEqual({
      directoryName: 'hello-card',
      pluginId: 'hello-card',
      packageName: 'agentcanvas-plugin-hello-card',
      displayName: 'Hello Card'
    });
  });

  it('creates a complete manifest-driven plugin', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'agentcanvas-scaffold-'));
    created.push(parent);
    const target = await scaffoldPlugin({ name: 'hello-card', cwd: parent });
    const manifest = JSON.parse(await readFile(join(target, 'agentcanvas.plugin.json'), 'utf8')) as unknown;
    assertPluginManifestStructure(manifest);
    expect(await readFile(join(target, 'src/server.mts'), 'utf8')).toContain('hello-card/hello-card');
    expect(await readFile(join(target, 'src/browser/entry.mts'), 'utf8')).not.toContain('__PLUGIN_ID__');
    expect(await readFile(join(target, '.gitignore'), 'utf8')).toContain('plugin-dist/');
    expect(await readFile(join(target, 'LICENSE'), 'utf8')).toContain('MIT License');
    expect(await readFile(join(target, 'scripts/verify-distribution.mjs'), 'utf8')).toContain(
      'assertDistributionArtifacts'
    );
  });

  it('rejects unsafe names and existing targets', async () => {
    expect(() => derivePluginNames('../escape')).toThrow(/lowercase/);
    const parent = await mkdtemp(join(tmpdir(), 'agentcanvas-scaffold-'));
    created.push(parent);
    await scaffoldPlugin({ name: 'taken', cwd: parent });
    await expect(scaffoldPlugin({ name: 'taken', cwd: parent })).rejects.toThrow(/already exists/);
  });
});
