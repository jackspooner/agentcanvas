import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ElementTypeDescriptor,
  PluginManifest,
  PluginMigrationDescriptor,
  PluginProcedureDescriptor,
  PluginToolDescriptor,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { assertContributionRegistrations, assertPluginManifestStructure } from '@agentcanvas/plugin-testkit';
import { describe, expect, it } from 'vitest';
import plugin, { importLegacy, renderSnapshot } from '../src/server.mjs';

function hostFixture() {
  const elements: ElementTypeDescriptor[] = [];
  const tools: PluginToolDescriptor[] = [];
  const procedures: PluginProcedureDescriptor[] = [];
  const migrations: PluginMigrationDescriptor[] = [];
  const host: ServerPluginHost = {
    registerElementType: (value) => elements.push(value),
    registerTool: (value) => tools.push(value),
    registerProcedure: (value) => procedures.push(value),
    registerMigration: (value) => migrations.push(value),
    provideCapability: () => {
      throw new Error('not used');
    },
    consumeCapability: () => {
      throw new Error('not used');
    },
    config: { accentColor: '#2563eb', maxMessageLength: 500 },
    kv: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
      list: async () => ({ entries: [] })
    },
    diagnostics: { emit() {} }
  };
  return { host, elements, tools, procedures, migrations };
}

describe('__DISPLAY_NAME__ server plugin', () => {
  it('registers exactly the declared contributions', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8')
    ) as PluginManifest;
    assertPluginManifestStructure(manifest);
    const fixture = hostFixture();
    await plugin.activate(fixture.host);
    assertContributionRegistrations(manifest.contributes, {
      elements: fixture.elements.map((value) => value.name),
      tools: fixture.tools.map((value) => value.name),
      procedures: fixture.procedures.map((value) => value.name),
      migrations: fixture.migrations.map((value) => value.name)
    });
  });

  it('imports legacy data deterministically and renders safe scene nodes', () => {
    const legacy = { id: 'card-1', type: 'helloCard', x: 10, y: 20, title: 'Hello', message: 'World' };
    expect(importLegacy(legacy)).toEqual(importLegacy(legacy));
    const element = importLegacy(legacy).element;
    expect(element.type).toBe('__PLUGIN_ID__/hello-card');
    expect(renderSnapshot(element).nodes.map((node) => node.kind)).toEqual(['rect', 'text', 'text']);
  });
});
