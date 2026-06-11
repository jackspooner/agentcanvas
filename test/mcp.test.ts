import { describe, expect, it, vi } from 'vitest';
import { createCanvasMcpHandlers } from '../src/mcp/client';

describe('AgentCanvasMcp handlers', () => {
  it('maps canvas_add_markdown to HTTP batch mutation', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const handlers = createCanvasMcpHandlers({
      baseUrl: 'http://127.0.0.1:23003',
      fetchImpl: vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ path: url.replace('http://127.0.0.1:23003', ''), init });
        return new Response(JSON.stringify({ ok: true, canvas: { id: 'canvas_1', revision: 2 }, revision: 2 }), { headers: { 'content-type': 'application/json' } });
      })
    });
    const result = await handlers.canvas_add_markdown({ canvasId: 'canvas_1', markdown: '# Hi', x: 1, y: 2 });
    expect(result.ok).toBe(true);
    expect(requests[0].path).toBe('/api/canvases/canvas_1/elements:batch');
    expect(JSON.parse(String(requests[0].init?.body)).operations[0].element.type).toBe('markdown');
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
});
