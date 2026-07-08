import fs from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appShell, createAgentCanvasServiceHandler, createApp } from '../src/server';
import { SqliteCanvasStore } from '../src/store/sqlite';

describe('AgentCanvas HTTP API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the built Vite app shell when dist/web/index.html exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-web-'));
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>'
    );
    expect(appShell('AgentCanvas', dir)).toContain('/assets/app.js');
  });

  it('serves the web app shell from the root canvas chooser route', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const response = await app.request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('AgentCanvas');
  });

  it('reports health and whoami capabilities', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const health = await app.request('/health');
    expect(await health.json()).toMatchObject({ ok: true, service: 'AgentCanvas' });

    const whoami = await app.request('/whoami');
    const body = await whoami.json();
    expect(body.capabilities).toMatchObject({
      markdown: true,
      sqlite: true,
      dedicated_mcp: true,
      glb_viewers: true,
      bbox_overlays: true
    });
    expect(body.mcp).toMatchObject({
      endpoint: 'http://127.0.0.1:23003/mcp',
      transport: 'streamable-http',
      stdioCompatible: true
    });
    expect(body.port).toBe(23003);
  });

  it('serves stateless streamable HTTP MCP at /mcp for initialization, tool listing, and read-only tool calls', async () => {
    const store = new SqliteCanvasStore(':memory:');
    const handler = createAgentCanvasServiceHandler({ store });
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const mcpUrl = `http://127.0.0.1:${port}/mcp`;

    async function postMcp(body: Record<string, unknown>) {
      const response = await fetch(mcpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<Record<string, any>>;
    }

    try {
      const initialized = await postMcp({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'agent-canvas-vitest', version: '0.1.0' }
        }
      });
      expect(initialized.result.serverInfo).toMatchObject({ name: 'AgentCanvasMcp', version: '0.1.0' });

      const listed = await postMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain('canvas_list');

      const called = await postMcp({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'canvas_list', arguments: {} }
      });
      expect(called.result.content[0].type).toBe('text');
      expect(JSON.parse(called.result.content[0].text)).toMatchObject({ ok: true, canvases: [] });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('warns when a placed node overlaps another node and reports the overlap percentage', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Overlap canvas' })
    });
    const body = await created.json();
    const canvasId = body.canvas.id;

    await app.request(`/api/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: { id: 'base', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'Base' }
          }
        ]
      })
    });

    const response = await app.request(`/api/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: { id: 'overlap', type: 'text', x: 50, y: 25, width: 200, height: 100, text: 'Overlap' }
          }
        ]
      })
    });

    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.warnings).toHaveLength(1);
    expect(updated.warnings[0]).toContain('18.75% of "overlap"');
    expect(updated.overlapWarnings).toMatchObject([
      {
        code: 'element_overlap',
        elementId: 'overlap',
        overlapPercent: 18.75,
        overlapArea: 3750,
        overlaps: [{ elementId: 'base', overlapPercent: 18.75, intersectionArea: 3750 }]
      }
    ]);
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
      body: JSON.stringify({
        operations: [
          { op: 'upsertElement', element: { id: 'md', type: 'markdown', x: 10, y: 10, markdown: '## Hello' } },
          {
            op: 'upsertElement',
            element: {
              id: 'asset',
              type: 'asset',
              x: 50,
              y: 50,
              assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000000' }
            }
          }
        ]
      })
    });
    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements).toHaveLength(2);
  });

  it('adds bbox overlay nodes and projects the optional backing image through the same-origin asset proxy', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'BBox canvas', project: 'demo' })
    });
    const canvas = await created.json();

    const batch = await app.request(`/api/canvases/${canvas.canvas.id}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'bbox_1',
              type: 'bboxOverlay',
              x: 120,
              y: 140,
              width: 512,
              height: 768,
              canvasWidth: 1024,
              canvasHeight: 1536,
              imageAssetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000777' },
              caption: 'Character bboxes',
              boxes: [{ id: 'title', x: 105, y: 960, width: 814, height: 72, label: 'Title' }]
            }
          }
        ]
      })
    });

    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements[0]).toMatchObject({
      type: 'bboxOverlay',
      imageResolvedUrl: '/api/assets/demo/00000000-0000-4000-8000-000000000777/content',
      canvasWidth: 1024,
      canvasHeight: 1536,
      boxes: [{ id: 'title', x: 105, y: 960, width: 814, height: 72, label: 'Title' }]
    });
  });

  it('hydrates bbox overlay nodes from a bbox layout asset instead of inline canvas data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000888/content');
        return new Response(
          JSON.stringify({
            schema: 'bbox-layout/v1',
            canvasWidth: 2932,
            canvasHeight: 4096,
            caption: 'Asset-backed layout',
            background: '#fafaf9',
            boxes: [{ id: 'title', x: 240, y: 2528, width: 2464, height: 224, label: 'CARD NAME' }]
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'BBox canvas', project: 'demo' })
    });
    const canvas = await created.json();

    const batch = await app.request(`/api/canvases/${canvas.canvas.id}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'bbox_1',
              type: 'bboxOverlay',
              x: 120,
              y: 140,
              width: 512,
              height: 768,
              layoutAssetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000888' }
            }
          }
        ]
      })
    });

    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements[0]).toMatchObject({
      type: 'bboxOverlay',
      layoutAssetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000888' },
      layoutResolvedUrl: 'http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000888',
      layoutSchema: 'bbox-layout/v1',
      canvasWidth: 2932,
      canvasHeight: 4096,
      boxes: [{ id: 'title', x: 240, y: 2528, width: 2464, height: 224, label: 'CARD NAME' }],
      caption: 'Asset-backed layout'
    });
  });

  it('adds path overlay nodes and returns their internal coordinate-space geometry', async () => {
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });
    const created = await app.request('/api/canvases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Path canvas', project: 'demo' })
    });
    const canvas = await created.json();

    const batch = await app.request(`/api/canvases/${canvas.canvas.id}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'path_1',
              type: 'pathOverlay',
              x: 120,
              y: 140,
              width: 512,
              height: 768,
              canvasWidth: 2932,
              canvasHeight: 4096,
              caption: 'Card name path',
              paths: [
                {
                  id: 'name_panel',
                  d: 'M 260 2700 Q 320 2520 520 2520 L 2412 2520 Q 2612 2520 2672 2700 Z',
                  label: 'CARD NAME'
                }
              ]
            }
          }
        ]
      })
    });

    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements[0]).toMatchObject({
      type: 'pathOverlay',
      canvasWidth: 2932,
      canvasHeight: 4096,
      caption: 'Card name path',
      paths: [{ id: 'name_panel', label: 'CARD NAME' }]
    });
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
      body: JSON.stringify({
        operations: [
          {
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
          }
        ]
      })
    });

    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements[0]).toMatchObject({
      type: 'glbViewer',
      resolvedUrl: '/api/assets/demo/00000000-0000-4000-8000-000000000123/content'
    });
  });

  it('adds GLB viewer nodes by assetKey and projects a host-relative proxied content URL', async () => {
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
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'glb_key_1',
              type: 'glbViewer',
              x: 120,
              y: 140,
              width: 320,
              height: 240,
              assetRef: { type: 'asset', project: 'demo', assetKey: 'models/glb/chair-v1' },
              caption: 'chair.glb'
            }
          }
        ]
      })
    });

    expect(batch.status).toBe(200);
    const updated = await batch.json();
    expect(updated.canvas.elements[0]).toMatchObject({
      type: 'glbViewer',
      resolvedUrl: '/api/assets/demo/by-key/content?assetKey=models%2Fglb%2Fchair-v1'
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

  it('proxies GLB asset content by project-scoped assetKey', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://127.0.0.1:23000/projects/demo/assets/by-key/models/glb/chair-v1') {
        return new Response(JSON.stringify({ filename: 'chair.glb', content_type: 'model/gltf-binary' }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      expect(url).toBe('http://127.0.0.1:23000/projects/demo/assets/by-key/models/glb/chair-v1/content');
      return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
        headers: { 'content-type': 'model/gltf-binary', 'content-length': '4' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/by-key/content?assetKey=models%2Fglb%2Fchair-v1');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.headers.get('content-type')).toContain('model/gltf-binary');
    expect(await response.text()).toBe('glTF');
  });

  it('proxies safe raster image content for same-origin preview thumbnails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/content')) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          headers: { 'content-type': 'image/png', 'content-length': '4' }
        });
      }
      return new Response(JSON.stringify({ filename: 'preview.png', content_type: 'image/png' }), {
        headers: { 'content-type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/00000000-0000-4000-8000-000000000124/content');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects active upstream content even when asset metadata declares a safe image type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/content')) {
          return new Response('<svg><script>alert(1)</script></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          });
        }
        return new Response(JSON.stringify({ filename: 'preview.png', content_type: 'image/png' }), {
          headers: { 'content-type': 'application/json' }
        });
      })
    );
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/00000000-0000-4000-8000-000000000125/content');

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'unsupported_asset_type' });
  });

  it('rejects active image content from the same-origin asset proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/content')) {
          return new Response('<svg><script>alert(1)</script></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          });
        }
        return new Response(JSON.stringify({ filename: 'xss.svg', content_type: 'image/svg+xml' }), {
          headers: { 'content-type': 'application/json' }
        });
      })
    );
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/00000000-0000-4000-8000-000000000123/content');

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'unsupported_asset_type' });
  });

  it('returns normalized asset generation details with context image resolved URLs', async () => {
    const assetId = '00000000-0000-4000-8000-000000000123';
    const contextId = '00000000-0000-4000-8000-000000000456';
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`http://127.0.0.1:23000/projects/demo/assets/${assetId}`);
      return new Response(
        JSON.stringify({
          id: assetId,
          project: 'demo',
          filename: 'image-1.png',
          content_type: 'image/png',
          size_bytes: 1234,
          content_sha256: 'abc123',
          created_at: '2026-06-13T11:30:52.000Z',
          updated_at: '2026-06-13T11:31:00.000Z',
          metadata: {
            title: 'Generated image',
            kind: 'image',
            cost: {
              currency: 'USD',
              amount: 0.006,
              estimated: true,
              pricingSource: 'pricing-catalog',
              pricingVersion: '2026-06-19'
            },
            generation: {
              service: 'RouterImage-2',
              tool: 'image_generate_asset',
              provider: 'openai',
              model: 'gpt-image-2',
              requestId: 'req_1',
              imageIndex: 1,
              generatedAt: '2026-06-13T11:30:53.000Z',
              settings: { quality: 'low', size: { width: 1024, height: 1536 }, controls: { style: 'storybook' } },
              prompt: 'Draw a card.',
              jsonPrompt: { text: 'Draw a card.', localPath: 'C:/private/secret.png', apiKey: 'must-not-leak' },
              contextImages: [{ type: 'asset', project: 'demo', assetId: contextId }],
              providerRequest: { model: 'gpt-image-2', quality: 'low', apiKey: 'must-not-leak' }
            }
          }
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request(`/api/assets/demo/${assetId}/details`);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      asset: {
        project: 'demo',
        assetId,
        filename: 'image-1.png',
        contentType: 'image/png',
        width: 1024,
        height: 1536,
        createdAt: '2026-06-13T11:30:52.000Z'
      },
      cost: {
        currency: 'USD',
        amount: 0.006,
        estimated: true,
        pricingSource: 'pricing-catalog',
        pricingVersion: '2026-06-19'
      },
      generation: {
        provider: 'openai',
        model: 'gpt-image-2',
        quality: 'low',
        prompt: 'Draw a card.',
        jsonPrompt: { text: 'Draw a card.', localPath: '[redacted]' },
        contextImages: [
          { type: 'asset', project: 'demo', assetId: contextId, resolvedUrl: `/api/assets/demo/${contextId}/content` }
        ],
        controls: { style: 'storybook' },
        providerRequest: { model: 'gpt-image-2', quality: 'low' },
        requestId: 'req_1',
        generatedAt: '2026-06-13T11:30:53.000Z'
      },
      warnings: []
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    expect(JSON.stringify(body)).not.toContain('C:/private');
    expect(body.asset.metadata).toBeUndefined();
  });

  it('returns normalized asset details by project-scoped assetKey', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://127.0.0.1:23000/projects/demo/assets/by-key/images/generated/card-v1');
      return new Response(
        JSON.stringify({
          id: '00000000-0000-4000-8000-000000000321',
          asset_key: 'images/generated/card-v1',
          project: 'demo',
          filename: 'card.png',
          content_type: 'image/png',
          size_bytes: 1234,
          image_width_px: 720,
          image_height_px: 960,
          metadata: { title: 'Generated card', kind: 'image' }
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request('/api/assets/demo/by-key/details?assetKey=images%2Fgenerated%2Fcard-v1');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      ok: true,
      asset: { assetId: '00000000-0000-4000-8000-000000000321', filename: 'card.png', width: 720, height: 960 },
      generation: null
    });
  });

  it('computes raster dimensions for uploaded images without generation metadata', async () => {
    const assetId = '00000000-0000-4000-8000-000000000789';
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    const view = new DataView(png.buffer);
    view.setUint32(16, 720, false);
    view.setUint32(20, 316, false);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === `http://127.0.0.1:23000/projects/demo/assets/${assetId}`) {
        return new Response(
          JSON.stringify({
            id: assetId,
            project: 'demo',
            filename: 'upload.png',
            content_type: 'image/png',
            size_bytes: 99,
            content_sha256: 'def456',
            created_at: '2026-06-13T11:30:52.000Z',
            updated_at: '2026-06-13T11:31:00.000Z',
            metadata: { title: 'Uploaded image', kind: 'image' }
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      }
      if (url === `http://127.0.0.1:23000/projects/demo/assets/${assetId}/content`) {
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ store: new SqliteCanvasStore(':memory:') });

    const response = await app.request(`/api/assets/demo/${assetId}/details`);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({
      ok: true,
      asset: { assetId, filename: 'upload.png', width: 720, height: 316 },
      generation: null,
      warnings: ['generation_not_recorded']
    });
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
    expect(await initial.json()).toMatchObject({
      ok: true,
      userViewport: { centerX: 0, centerY: 0, zoom: 1, width: 1920, height: 900, source: 'default' },
      agentViewport: null
    });

    const saved = await app.request(`/api/canvases/${canvasId}/viewport`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'user', centerX: -300, centerY: 250, zoom: 1.25, width: 1600, height: 900 })
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      ok: true,
      viewport: { source: 'user', centerX: -300, centerY: 250, zoom: 1.25 }
    });

    const focused = await app.request(`/api/canvases/${canvasId}/viewport/focus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ centerX: 1000, centerY: -500, zoom: 0.8 })
    });
    expect(focused.status).toBe(200);
    expect(await focused.json()).toMatchObject({
      ok: true,
      viewport: { source: 'agent', centerX: 1000, centerY: -500, zoom: 0.8, width: 1920, height: 900 }
    });
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
      body: JSON.stringify({
        operations: [
          {
            op: 'upsertElement',
            element: {
              id: 'person_card',
              type: 'markdown',
              x: 10,
              y: 20,
              width: 260,
              height: 140,
              markdown: '## Family Hero\n\n- Charm 92'
            }
          },
          {
            op: 'upsertElement',
            element: { id: 'note_1', type: 'text', x: 320, y: 20, width: 180, height: 80, text: 'Proof gate' }
          }
        ]
      })
    });

    const response = await app.request(`/api/canvases/${canvasId}/screenshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overlayNodeIds: true, fullCanvas: true })
    });

    expect(response.status).toBe(200);
    const screenshot = await response.json();
    expect(screenshot).toMatchObject({
      ok: true,
      screenshot: { format: 'svg', mimeType: 'image/svg+xml', overlayNodeIds: true }
    });
    const svg = Buffer.from(
      String(screenshot.screenshot.dataUrl).replace(/^data:image\/svg\+xml;base64,/, ''),
      'base64'
    ).toString('utf-8');
    expect(svg).toContain('Family Hero');
    expect(svg).toContain('person_card');
    expect(svg).toContain('note_1');
    expect(screenshot.screenshot.url).toContain(`/api/canvases/${canvasId}/screenshots/`);
  });
});
