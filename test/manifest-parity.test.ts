import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { validatePluginManifest } from '../src/plugin-runtime/manifest';

function manifest(): PluginManifest {
  return JSON.parse(fs.readFileSync('plugin-packages/primitives/agentcanvas.plugin.json', 'utf8'));
}

function check(value: PluginManifest, accepted: boolean): void {
  const before = structuredClone(value);
  expect(validatePluginManifestStructure(value).ok).toBe(accepted);
  if (accepted) expect(validatePluginManifest(value)).toEqual(value);
  else expect(() => validatePluginManifest(value)).toThrow();
  expect(value).toEqual(before);
}

describe('canonical manifest parity', () => {
  it.each([
    ['displayName', 200],
    ['description', 2000],
    ['license', 100],
    ['id', 128]
  ] as const)('shares the %s boundary', (field, limit) => {
    const value = manifest();
    value[field] = 'a'.repeat(limit);
    check(value, true);
    value[field] += 'a';
    check(value, false);
  });

  it('accepts the former display-name mismatch and rejects the former licence mismatch', () => {
    check({ ...manifest(), displayName: 'a'.repeat(150) }, true);
    check({ ...manifest(), license: 'a'.repeat(110) }, false);
  });

  it('shares local names, safe integer versions and duplicate-name checks', () => {
    const base = manifest();
    const element = { ...base.contributes.elements[0], name: 'a'.repeat(64), schemaVersion: Number.MAX_SAFE_INTEGER };
    const value = { ...base, contributes: { ...base.contributes, elements: [element] } };
    check(value, true);
    check({ ...value, contributes: { ...value.contributes, elements: [{ ...element, name: 'a'.repeat(65) }] } }, false);
    for (const schemaVersion of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      check({ ...value, contributes: { ...value.contributes, elements: [{ ...element, schemaVersion }] } }, false);
    }
    check(
      { ...value, contributes: { ...value.contributes, elements: [element, { ...element, schemaVersion: 1 }] } },
      false
    );
  });

  it.each([
    '../server.mjs',
    '/server.mjs',
    'C:/server.mjs',
    'dist\\server.mjs',
    'dist//server.mjs',
    './server.mjs',
    'dist/./server.mjs',
    'server.mjs?x',
    'server.mjs#x',
    'server\0.mjs'
  ])('rejects unsafe path %s', (server) => check({ ...manifest(), entrypoints: { server } }, false));

  it('requires browser commands, rejects unknown fields and enforces environment names', () => {
    const base = manifest();
    check(
      { ...base, entrypoints: { server: 'server.mjs' }, contributes: { ...base.contributes, commands: ['run'] } },
      false
    );
    check({ ...base, unexpected: true } as PluginManifest, false);
    const configuration = { schema: 'schema.json', file: 'config.json', environment: ['VALID_NAME'] };
    check({ ...base, configuration }, true);
    for (const name of ['_LEADING', 'lowercase', '1NUMBER'])
      check({ ...base, configuration: { ...configuration, environment: [name] } }, false);
    check({ ...base, requires: { ...base.requires, capabilities: { 'custom/name@1': '^1.0.0' } } }, true);
  });

  it('reserves semver validation for the runtime', () => {
    const value = manifest();
    value.requires = { ...value.requires, hostApi: 'not-a-version' };
    expect(validatePluginManifestStructure(value).ok).toBe(true);
    expect(() => validatePluginManifest(value)).toThrow();
  });

  it('accepts all first-party and external fixture manifests', () => {
    const files = fs
      .readdirSync('plugin-packages')
      .map((name) => path.join('plugin-packages', name, 'agentcanvas.plugin.json'));
    files.push('test/external-plugin-fixture/agentcanvas.plugin.json');
    for (const file of files) check(JSON.parse(fs.readFileSync(file, 'utf8')), true);
  });
});
