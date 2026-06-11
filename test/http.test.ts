import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appShell, createApp } from '../src/server';
import { SqliteCanvasStore } from '../src/store/sqlite';

describe('AgentCanvas HTTP API', () => {


  it('uses the built Vite app shell when dist/web/index.html exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-web-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>');
    expect(appShell('AgentCanvas', dir)).toContain('/assets/app.js');
  });
  it('reports health and whoami capabilities', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const health = await app.request('/health');
    expect(await health.json()).toMatchObject({ ok: true, service: 'AgentCanvas' });

    const whoami = await app.request('/whoami');
    const body = await whoami.json();
    expect(body.capabilities).toMatchObject({ markdown: true, sqlite: true, dedicated_mcp: true });
    expect(body.port).toBe(23003);
  });

  it('creates canvases, adds markdown/assets, and returns share links', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'HTTP canvas', project: 'demo', createShareLink: true })
    });
    expect(created.status).toBe(201);
    const canvas = await created.json();
    expect(canvas.links.share).toContain('/c/');

    const batch = await app.request(`/api/canvases/${canvas.canvas.id}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [
        { op: 'upsertElement', element: { id: 'md', type: 'markdown', x: 10, y: 10, markdown: '## Hello' } },
        { op: 'upsertElement', element: { id: 'asset', type: 'asset', x: 50, y: 50, assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000000' } } }
      ] })
    });
    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements).toHaveLength(2);
  });

  it('exposes viewport routes for user persistence and agent focus control', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Viewport canvas' })
    });
    const body = await created.json();
    const canvasId = body.canvas.id;

    const initial = await app.request(`/api/canvases/${canvasId}/viewport`);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ ok: true, userViewport: { centerX: 0, centerY: 0, zoom: 1, width: 1920, height: 900, source: 'default' }, agentViewport: null });

    const saved = await app.request(`/api/canvases/${canvasId}/viewport`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'user', centerX: -300, centerY: 250, zoom: 1.25, width: 1600, height: 900 })
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, viewport: { source: 'user', centerX: -300, centerY: 250, zoom: 1.25 } });

    const focused = await app.request(`/api/canvases/${canvasId}/viewport/focus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ centerX: 1000, centerY: -500, zoom: 0.8 })
    });
    expect(focused.status).toBe(200);
    expect(await focused.json()).toMatchObject({ ok: true, viewport: { source: 'agent', centerX: 1000, centerY: -500, zoom: 0.8, width: 1920, height: 900 } });
  });
});
