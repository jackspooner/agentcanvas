import { describe, expect, it, vi } from 'vitest';
import { createCanvasMcpHandlers } from '../src/mcp/client';

describe('AgentCanvasMcp handlers', () => {
  it('maps canvas_add_markdown to HTTP batch mutation', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ path: url.replace('http://127.0.0.1:23003', ''), init });
        return new Response(JSON.stringify({ ok: true, canvas: { id: 'canvas_1', revision: 2, elements: [{ id: 'markdown_1', type: 'markdown', markdown: '# Hi', x: 1, y: 2 }] }, revision: 2, links: { view: 'http://canvas/canvas_1' } }), { headers: { 'content-type': 'application/json' } });
      })
    });
    const result = await handlers.canvas_add_markdown({ canvasId: 'canvas_1', markdown: '# Hi', x: 1, y: 2 });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ canvasId: 'canvas_1', revision: 2, links: { view: 'http://canvas/canvas_1' } });
    expect(result).not.toHaveProperty('canvas');
    expect(requests[0].path).toBe('/api/canvases/canvas_1/elements:batch');
    expect(JSON.parse(String(requests[0].init?.body)).operations[0].element.type).toBe('markdown');
  });

  it('allows full mode for canvas mutation tools when the complete canvas is needed', async () => {
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: true, canvas: { id: 'canvas_1', revision: 2, elements: [{ id: 'markdown_1', type: 'markdown', markdown: '# Hi', x: 1, y: 2 }] }, revision: 2 }), { headers: { 'content-type': 'application/json' } }))
    });

    const result = await handlers.canvas_add_markdown({ canvasId: 'canvas_1', markdown: '# Hi', x: 1, y: 2, mode: 'full' });

    expect(result.canvas).toMatchObject({ id: 'canvas_1', elements: [{ id: 'markdown_1' }] });
  });

  it('maps canvas_place_glb_viewer to a GLB viewer element batch mutation', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ path: url.replace('http://127.0.0.1:23003', ''), init });
        return new Response(JSON.stringify({ ok: true, canvas: { id: 'canvas_1', revision: 2 }, revision: 2 }), { headers: { 'content-type': 'application/json' } });
      })
    });

    await handlers.canvas_place_glb_viewer({
      canvasId: 'canvas_1',
      id: 'glb_1',
      assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000123' },
      x: 100,
      y: 200,
      width: 320,
      height: 240,
      caption: 'single.glb'
    });

    expect(requests[0].path).toBe('/api/canvases/canvas_1/elements:batch');
    expect(JSON.parse(String(requests[0].init?.body)).operations[0].element).toMatchObject({
      id: 'glb_1',
      type: 'glbViewer',
      width: 320,
      height: 240,
      caption: 'single.glb'
    });
  });

  it('maps viewport tools to HTTP viewport routes', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ path: url.replace('http://127.0.0.1:23003', ''), init });
        return new Response(JSON.stringify({ ok: true, userViewport: { centerX: 0, centerY: 0, zoom: 1, width: 1920, height: 900, source: 'default' }, viewport: { centerX: 10, centerY: 20, zoom: 1.2, width: 1920, height: 900, source: 'agent' } }), { headers: { 'content-type': 'application/json' } });
      })
    });

    await handlers.canvas_get_viewport({ canvasId: 'canvas_1' });
    await handlers.canvas_set_viewport({ canvasId: 'canvas_1', centerX: 10, centerY: 20, zoom: 1.2 });

    expect(requests[0].path).toBe('/api/canvases/canvas_1/viewport');
    expect(requests[0].init?.method).toBeUndefined();
    expect(requests[1].path).toBe('/api/canvases/canvas_1/viewport/focus');
    expect(JSON.parse(String(requests[1].init?.body))).toMatchObject({ centerX: 10, centerY: 20, zoom: 1.2 });
  });

  it('maps canvas_screenshot to the HTTP screenshot route with node id overlay options', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ path: url.replace('http://127.0.0.1:23003', ''), init });
        return new Response(JSON.stringify({ ok: true, screenshot: { format: 'svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', overlayNodeIds: true } }), { headers: { 'content-type': 'application/json' } });
      })
    });

    const result = await handlers.canvas_screenshot({ canvasId: 'canvas_1', overlayNodeIds: true, fullCanvas: true, width: 1200, height: 800 }) as { ok: boolean; screenshot: Record<string, unknown> };

    expect(result.ok).toBe(true);
    expect(result.screenshot).not.toHaveProperty('dataUrl');
    expect(requests[0].path).toBe('/api/canvases/canvas_1/screenshot');
    expect(requests[0].init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ overlayNodeIds: true, fullCanvas: true, width: 1200, height: 800 });
  });

  it('keeps screenshot data URLs only when explicitly requested', async () => {
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: true, screenshot: { format: 'svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', url: 'http://canvas/s.svg' } }), { headers: { 'content-type': 'application/json' } }))
    });

    const result = await handlers.canvas_screenshot({ canvasId: 'canvas_1', includeDataUrl: true }) as { screenshot: Record<string, unknown> };

    expect(result.screenshot).toHaveProperty('dataUrl', 'data:image/svg+xml;base64,PHN2Zy8+');
  });

  it('returns a compact canvas summary by default', async () => {
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        ok: true,
        canvas: {
          id: 'canvas_1',
          title: 'Large canvas',
          description: 'Demo',
          project: 'demo',
          revision: 7,
          width: 1600,
          height: 1000,
          metadata: { noisy: true },
          elements: [
            { id: 'markdown_1', type: 'markdown', markdown: 'x'.repeat(1000), x: 10, y: 20, width: 300, height: 200 },
            { id: 'asset_1', type: 'asset', assetRef: { type: 'asset', project: 'demo', assetId: 'asset_1', assetBaseUrl: 'http://assets' }, resolvedUrl: 'http://assets/content', metadata: { noisy: true }, x: 40, y: 50, width: 100, height: 100, caption: 'Asset' }
          ]
        },
        links: { view: 'http://canvas/canvas_1' }
      }), { headers: { 'content-type': 'application/json' } }))
    });

    const result = await handlers.canvas_get({ canvasId: 'canvas_1' });

    expect(result.canvas).toMatchObject({ id: 'canvas_1', elementCount: 2, returnedElements: 2, truncated: false });
    expect(result.canvas.elements[0].markdownSnippet.length).toBeLessThan(250);
    expect(result.canvas.elements[0]).not.toHaveProperty('markdown');
    expect(result.canvas.elements[1]).not.toHaveProperty('metadata');
  });
});
