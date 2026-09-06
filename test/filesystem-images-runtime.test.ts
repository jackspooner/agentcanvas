import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpV2Server } from '../src/mcp-v2/server';
import { createV2App, createV2Runtime } from '../src/server-v2';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function filesystemPluginFixture(): { pluginsRoot: string; imageRoot: string } {
  const temporaryParent = path.resolve('tmp');
  fs.mkdirSync(temporaryParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryParent, 'agentcanvas-filesystem-runtime-'));
  temporaryRoots.push(root);
  const pluginsRoot = path.join(root, 'plugins');
  const imageRoot = path.join(root, 'images');
  const pluginRoot = path.join(pluginsRoot, 'agentcanvas.filesystem-images');
  const sourceRoot = path.resolve('plugin-packages', 'filesystem-images');
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.mkdirSync(imageRoot, { recursive: true });
  for (const name of ['agentcanvas.plugin.json', 'LICENSE', 'README.md']) {
    fs.copyFileSync(path.join(sourceRoot, name), path.join(pluginRoot, name));
  }
  fs.cpSync(path.join(sourceRoot, 'dist'), path.join(pluginRoot, 'dist'), { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'src'), path.join(pluginRoot, 'src'), { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'schemas'), path.join(pluginRoot, 'schemas'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'plugin.config.json'),
    JSON.stringify({ roots: [{ id: 'images', path: imageRoot }], contentMaxBytes: 1024, resourceTtlMs: 60_000 })
  );
  fs.writeFileSync(path.join(imageRoot, 'sample.png'), Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { pluginsRoot, imageRoot };
}

describe('filesystem image runtime without Assets-2', () => {
  it('starts healthy, projects file bytes, rejects unsafe paths, and renders a snapshot', async () => {
    const fixture = filesystemPluginFixture();
    const runtime = await createV2Runtime({
      pluginsRoot: fixture.pluginsRoot,
      databasePath: ':memory:',
      config: { publicBaseUrl: 'http://127.0.0.1:23003' }
    });
    const app = createV2App(runtime);

    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, dependencies: {} });
    expect(await (await app.request('/whoami')).json()).toMatchObject({
      plugins: ['agentcanvas.filesystem-images'],
      dependencies: {}
    });

    const created = await (
      await app.request('/api/v1/canvases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Filesystem-only canvas' })
      })
    ).json();
    const canvasId = created.canvas.id as string;
    const validElement = {
      id: 'local-image',
      type: 'agentcanvas.filesystem-images/image',
      schemaVersion: 1,
      x: 10,
      y: 20,
      width: 160,
      height: 100,
      data: { source: { rootId: 'images', path: 'sample.png' }, caption: 'Local file' }
    };
    const mutation = await app.request(`/api/v1/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'upsertElement', element: validElement }] })
    });
    expect(mutation.status).toBe(200);
    const projection = await mutation.json();
    expect(projection.diagnostics).toEqual([]);
    expect(projection.elementRuntime['local-image']).toMatchObject({
      mimeType: 'image/png',
      byteLength: 8,
      contentUrl: expect.stringMatching(/^\/api\/v1\/resources\//)
    });

    const content = await app.request(projection.elementRuntime['local-image'].contentUrl);
    expect(content.status, await content.clone().text()).toBe(200);
    expect(content.headers.get('content-type')).toBe('image/png');
    expect(Array.from(new Uint8Array(await content.arrayBuffer()))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const unsafe = await app.request(`/api/v1/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              ...validElement,
              id: 'unsafe-image',
              data: { source: { rootId: 'images', path: '../sample.png' } }
            }
          }
        ]
      })
    });
    expect(unsafe.status).toBe(400);

    const mcp = createMcpV2Server({
      publicBaseUrl: runtime.config.publicBaseUrl,
      registry: runtime.registry,
      store: runtime.store,
      browserCatalog: runtime.browserCatalog,
      diagnostics: () => runtime.plugins.diagnostics.list()
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
    const invalidPath = await client.callTool({
      name: 'agentcanvas_filesystem_images__place',
      arguments: {
        canvasId,
        x: 10,
        y: 20,
        source: { rootId: 'images', path: 'folder\\sample.png' }
      }
    });
    expect(invalidPath.isError).toBe(true);
    expect(invalidPath.structuredContent).toMatchObject({
      problem: {
        code: 'validation_error',
        status: 400,
        retryable: false,
        instance: 'mcp://tool/agentcanvas_filesystem_images__place'
      }
    });
    await Promise.all([client.close(), mcp.server.close()]);

    const snapshotResponse = await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json();
    expect(snapshot.diagnostics).toEqual([]);
    const snapshotContent = await app.request(snapshot.snapshot.url);
    expect(snapshotContent.status).toBe(200);
    expect(snapshotContent.headers.get('content-type')).toBe('image/svg+xml');
    expect(await snapshotContent.text()).toContain('href="/api/v1/resources/');
    runtime.dispose();
  });
});
