import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appShell, createApp } from '../src/server';
import { SqliteCanvasStore } from '../src/store/sqlite';

describe('AgentCanvas HTTP API', () => {

  afterEach(() => {
    vi.restoreAllMocks();
  });


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
    expect(body.capabilities).toMatchObject({ markdown: true, sqlite: true, dedicated_mcp: true, glb_viewers: true });
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

  it('adds GLB viewer nodes and projects a host-relative proxied content URL', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'GLB canvas', project: 'demo' })
    });
    const canvas = await created.json();

    const batch = await app.request(`/api/canvases/${canvas.canvas.id}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{
        op: 'upsertElement',
        element: {
          id: 'glb_1',
          type: 'glbViewer',
          x: 120,
          y: 140,
          width: 320,
          height: 240,
          assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000123' },
          caption: 'single.glb'
        }
      }] })
    });

    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements[0]).toMatchObject({
      type: 'glbViewer',
      resolvedUrl: '/api/assets/demo/00000000-0000-4000-8000-000000000123/content'
    });
  });

  it('proxies GLB asset content through AgentCanvas so model-viewer can fetch same-origin bytes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000123') {
        return new Response(JSON.stringify({ filename: 'single.glb', content_type: 'model/gltf-binary' }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      expect(url).toBe('http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000123/content');
      return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
        headers: { 'content-type': 'model/gltf-binary', 'content-length': '4' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/00000000-0000-4000-8000-000000000123/content');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.headers.get('content-type')).toContain('model/gltf-binary');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('glTF');
  });

  it('rejects non-GLB content from the same-origin asset proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/content')) {
        return new Response('<svg><script>alert(1)</script></svg>', {
          headers: { 'content-type': 'image/svg+xml' }
        });
      }
      return new Response(JSON.stringify({ filename: 'xss.svg', content_type: 'image/svg+xml' }), {
        headers: { 'content-type': 'application/json' }
      });
    }));
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/00000000-0000-4000-8000-000000000123/content');

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'unsupported_asset_type' });
  });

  it('rejects invalid screenshot filenames before reading from disk', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/canvases/canvas_1/screenshots/..%2Fsecret.svg');

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_screenshot_name' });
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

  it('renders a canvas screenshot SVG with optional visible node id overlays', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Screenshot canvas' })
    });
    const body = await created.json();
    const canvasId = body.canvas.id;

    await app.request(`/api/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [
        { op: 'upsertElement', element: { id: 'person_card', type: 'markdown', x: 10, y: 20, width: 260, height: 140, markdown: '## Family Hero\n\n- Charm 92' } },
        { op: 'upsertElement', element: { id: 'note_1', type: 'text', x: 320, y: 20, width: 180, height: 80, text: 'Proof gate' } }
      ] })
    });

    const response = await app.request(`/api/canvases/${canvasId}/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overlayNodeIds: true, fullCanvas: true })
    });

    expect(response.status).toBe(200);
    const screenshot = await response.json();
    expect(screenshot).toMatchObject({ ok: true, screenshot: { format: 'svg', mimeType: 'image/svg+xml', overlayNodeIds: true } });
    const svg = Buffer.from(String(screenshot.screenshot.dataUrl).replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf-8');
    expect(svg).toContain('Family Hero');
    expect(svg).toContain('person_card');
    expect(svg).toContain('note_1');
    expect(screenshot.screenshot.url).toContain(`/api/canvases/${canvasId}/screenshots/`);
  });
});
