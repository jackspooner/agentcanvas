import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createV2App, createV2Runtime } from '../src/server-v2.js';
import { createMcpV2Server } from '../src/mcp-v2/server.js';
import { ViewerPresenceRegistry, VIEWER_PRESENCE_MAX_ACTIVE } from '../src/viewer-presence.js';

const viewport = { centerX: 12, centerY: -5, zoom: 2, width: 640, height: 480 };
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';

describe('viewer presence', () => {
  it('isolates canvases, refreshes sessions, and expires stale viewers', () => {
    let now = 0;
    const registry = new ViewerPresenceRegistry(() => now);
    registry.upsert('a', firstId, viewport);
    registry.upsert('a', secondId, { ...viewport, centerX: 50 });
    registry.upsert('b', firstId, viewport);
    expect(registry.list('a').viewers.map(({ viewerId }) => viewerId)).toEqual([firstId, secondId]);
    expect(registry.list('b').viewers).toHaveLength(1);
    now = 20_000;
    registry.upsert('a', firstId, { ...viewport, zoom: 3 });
    now = 30_000;
    expect(registry.list('a').viewers).toMatchObject([{ viewerId: firstId, viewport: { zoom: 3 } }]);
    expect(registry.list('b').viewers).toEqual([]);
    registry.remove('a', firstId);
    registry.remove('a', firstId);
    expect(registry.list('a').viewers).toEqual([]);
  });

  it('caps active sessions and makes capacity available again after expiry', () => {
    let now = 0;
    const registry = new ViewerPresenceRegistry(() => now);
    for (let index = 0; index < VIEWER_PRESENCE_MAX_ACTIVE; index++) {
      registry.upsert('a', String(index), viewport);
    }
    expect(() => registry.upsert('a', 'overflow', viewport)).toThrow('active viewer limit');
    try {
      registry.upsert('a', 'overflow', viewport);
    } catch (error) {
      expect(error).toMatchObject({ code: 'viewer_presence_capacity', status: 503 });
    }
    now = 30_000;
    expect(() => registry.upsert('a', 'replacement', viewport)).not.toThrow();
    expect(registry.list('a').viewers).toHaveLength(1);
  });

  it('validates HTTP reports and exposes only active geometry through MCP', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-viewer-'));
    const runtime = await createV2Runtime({ pluginsRoot: root, databasePath: ':memory:' });
    const app = createV2App(runtime);
    const canvas = runtime.store.createCanvas({ title: 'Viewed canvas' });
    const other = runtime.store.createCanvas({ title: 'Other canvas' });
    const base = `/api/v1/canvases/${canvas.id}/viewer-presence`;
    const put = (id: string, body: unknown) =>
      app.request(`${base}/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    const mcp = createMcpV2Server({ ...runtime, publicBaseUrl: runtime.config.publicBaseUrl, diagnostics: () => [] });
    const client = new Client({ name: 'viewer-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      expect((await put('invalid', viewport)).status).toBe(400);
      expect((await put(firstId, { ...viewport, width: 0 })).status).toBe(400);
      expect((await put(firstId, { ...viewport, zoom: 9 })).status).toBe(400);
      expect((await put(firstId, { ...viewport, extra: true })).status).toBe(400);
      expect(
        (await app.request(`/api/v1/canvases/missing/viewer-presence/${firstId}`, { method: 'DELETE' })).status
      ).toBe(404);
      expect((await put(firstId, viewport)).status).toBe(200);
      expect((await put(secondId, { ...viewport, centerX: 50 })).status).toBe(200);
      expect(runtime.store.getCanvas(canvas.id).revision).toBe(canvas.revision);
      expect(runtime.store.getViewportState(canvas.id).userViewport.source).toBe('default');
      await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.callTool({ name: 'canvas_list_viewers', arguments: { canvasId: canvas.id } });
      expect(listed.structuredContent).toMatchObject({
        canvasId: canvas.id,
        viewers: [
          { viewerId: firstId, viewport },
          { viewerId: secondId, viewport: { ...viewport, centerX: 50 } }
        ]
      });
      expect(listed.structuredContent).not.toHaveProperty('token');
      expect((await client.callTool({ name: 'canvas_list_viewers', arguments: { canvasId: 'missing' } })).isError).toBe(
        true
      );
      expect(
        (await client.callTool({ name: 'canvas_list_viewers', arguments: { canvasId: other.id } })).structuredContent
      ).toMatchObject({ viewers: [] });
      expect((await app.request(`${base}/${firstId}`, { method: 'DELETE' })).status).toBe(200);
      expect((await app.request(`${base}/${firstId}`, { method: 'DELETE' })).status).toBe(200);
      expect(runtime.viewerPresence.list(canvas.id).viewers.map(({ viewerId }) => viewerId)).toEqual([secondId]);
    } finally {
      await Promise.allSettled([client.close(), mcp.server.close()]);
      runtime.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
