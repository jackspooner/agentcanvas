import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginManifest } from '@agentcanvas/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverPlugins,
  orderPlugins,
  PluginRuntimeError,
  validatePluginManifest
} from '../src/plugin-runtime/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    apiVersion: 'agentcanvas.plugin/v1',
    id,
    version: '1.0.0',
    displayName: id,
    description: 'Test plugin',
    license: 'MIT',
    entrypoints: { server: 'dist/server.mjs' },
    requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
    provides: { capabilities: {} },
    permissions: [],
    contributes: { elements: [], tools: [], procedures: [], migrations: [] },
    ...overrides
  };
}

async function pluginFolder(root: string, folder: string, value: PluginManifest): Promise<void> {
  const path = join(root, folder);
  await mkdir(join(path, 'dist'), { recursive: true });
  await writeFile(join(path, 'agentcanvas.plugin.json'), JSON.stringify(value));
  await writeFile(join(path, 'dist', 'server.mjs'), 'export default { activate() {} };');
}

describe('plugin runtime foundation', () => {
  it.each([
    0, 1.5, 30001
  ])('rejects an invalid registered snapshot deadline %s during activation', async (snapshotTimeoutMs) => {
    const root = await mkdtemp(join(tmpdir(), 'agentcanvas-deadline-'));
    roots.push(root);
    await pluginFolder(root, 'deadline', manifest('agentcanvas.deadline'));
    await writeFile(
      join(root, 'deadline', 'dist', 'server.mjs'),
      `export default { activate(host) { host.registerElementType({ name: 'card', snapshotTimeoutMs: ${snapshotTimeoutMs} }); } };`
    );
    // Native Node imports exercise the same file-URL activation path as the server on Windows.
    const check = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { activatePlugins, discoverPlugins } from './src/plugin-runtime/index.ts';
      const plugins = await discoverPlugins({ pluginsRoot: process.argv[1] });
      await assert.rejects(activatePlugins(plugins, {
        kv: () => ({ get: async () => undefined, set: async () => {}, delete: async () => false, list: async () => ({ entries: [] }) }),
        diagnostics: () => ({ emit() {} })
      }), /snapshotTimeoutMs must be an integer/);
    `,
        root
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    expect(check.status, check.stderr).toBe(0);
  });
  it('strictly validates manifest versions and undeclared properties', () => {
    expect(validatePluginManifest(manifest('agentcanvas.demo')).id).toBe('agentcanvas.demo');
    expect(() => validatePluginManifest({ ...manifest('agentcanvas.demo'), extra: true })).toThrow(PluginRuntimeError);
    expect(() => validatePluginManifest(manifest('agentcanvas.demo', { version: 'latest' }))).toThrow(
      /semantic version/i
    );
  });

  it('discovers only immediate visible plugin folders in deterministic order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentcanvas-plugins-'));
    roots.push(root);
    await pluginFolder(root, 'zeta', manifest('agentcanvas.zeta'));
    await pluginFolder(root, 'alpha', manifest('agentcanvas.alpha'));
    await pluginFolder(root, '.staging', manifest('agentcanvas.staging'));
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'README.md'), 'runtime plugins');
    const plugins = await discoverPlugins({ pluginsRoot: root });
    expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(['agentcanvas.alpha', 'agentcanvas.zeta']);
  });

  it('rejects entrypoint traversal before importing code', () => {
    expect(() =>
      validatePluginManifest(manifest('agentcanvas.escape', { entrypoints: { server: '../outside.mjs' } }))
    ).toThrow(/manifest/i);
  });

  it('orders capability providers and plugin dependencies before consumers with a stable tie break', () => {
    const item = (value: PluginManifest) => ({ manifest: value, root: '', serverEntry: '', config: {} });
    const provider = item(
      manifest('agentcanvas.assets2', { provides: { capabilities: { 'agentcanvas.assets': '1.2.0' } } })
    );
    const consumer = item(
      manifest('agentcanvas.viewer', {
        requires: { hostApi: '^1.0.0', plugins: {}, capabilities: { 'agentcanvas.assets': '^1.0.0' } }
      })
    );
    const alpha = item(manifest('agentcanvas.alpha'));
    expect(orderPlugins([consumer, provider, alpha], '1.0.0').map((plugin) => plugin.manifest.id)).toEqual([
      'agentcanvas.alpha',
      'agentcanvas.assets2',
      'agentcanvas.viewer'
    ]);
  });

  it('reports dependency cycles and singleton capability conflicts', () => {
    const item = (value: PluginManifest) => ({ manifest: value, root: '', serverEntry: '', config: {} });
    const a = item(
      manifest('agentcanvas.a', { requires: { hostApi: '^1', plugins: { 'agentcanvas.b': '^1' }, capabilities: {} } })
    );
    const b = item(
      manifest('agentcanvas.b', { requires: { hostApi: '^1', plugins: { 'agentcanvas.a': '^1' }, capabilities: {} } })
    );
    expect(() => orderPlugins([a, b], '1.0.0')).toThrow(/cycle/i);
    const first = item(manifest('agentcanvas.one', { provides: { capabilities: { singleton: '1.0.0' } } }));
    const second = item(manifest('agentcanvas.two', { provides: { capabilities: { singleton: '1.0.0' } } }));
    expect(() => orderPlugins([first, second], '1.0.0')).toThrow(/multiple providers/i);
  });
});
