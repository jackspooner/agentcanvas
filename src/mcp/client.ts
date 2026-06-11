import { nanoid } from 'nanoid';

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface McpHandlerOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

async function readJson(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message ?? `AgentCanvas HTTP ${response.status}`);
  return body;
}

export function createCanvasMcpHandlers(options: McpHandlerOptions = {}) {
  const baseUrl = (options.baseUrl ?? process.env.AGENT_CANVAS_BASE_URL ?? 'http://127.0.0.1:23003').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const post = (path: string, body: unknown) => fetchImpl(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(readJson);
  const get = (path: string) => fetchImpl(`${baseUrl}${path}`).then(readJson);

  return {
    canvas_create: (input: Record<string, unknown>) => post('/api/canvases', { createShareLink: true, ...input }),
    canvas_list: (input: Record<string, unknown> = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null) params.set(k, String(v));
      return get(`/api/canvases${params.size ? `?${params}` : ''}`);
    },
    canvas_get: (input: { canvasId: string }) => get(`/api/canvases/${encodeURIComponent(input.canvasId)}`),
    canvas_get_link: (input: { canvasId: string; label?: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/share-links`, { mode: 'read', label: input.label }),
    canvas_add_text: (input: { canvasId: string; id?: string; text: string; x: number; y: number; width?: number; height?: number; style?: unknown }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `text_${nanoid(8)}`, type: 'text', text: input.text, x: input.x, y: input.y, width: input.width, height: input.height, style: input.style } }] }),
    canvas_add_markdown: (input: { canvasId: string; id?: string; markdown: string; x: number; y: number; width?: number; height?: number; style?: unknown }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `markdown_${nanoid(8)}`, type: 'markdown', markdown: input.markdown, x: input.x, y: input.y, width: input.width, height: input.height, style: input.style } }] }),
    canvas_place_asset: (input: { canvasId: string; id?: string; assetRef: unknown; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; fit?: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `asset_${nanoid(8)}`, type: 'asset', assetRef: input.assetRef, x: input.x, y: input.y, width: input.width, height: input.height, caption: input.caption, alt: input.alt, fit: input.fit } }] }),
    canvas_place_glb_viewer: (input: { canvasId: string; id?: string; assetRef: unknown; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; cameraControls?: boolean; autoRotate?: boolean }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `glb_${nanoid(8)}`, type: 'glbViewer', assetRef: input.assetRef, x: input.x, y: input.y, width: input.width ?? 320, height: input.height ?? 240, caption: input.caption, alt: input.alt, cameraControls: input.cameraControls, autoRotate: input.autoRotate } }] }),
    canvas_add_line: (input: { canvasId: string; id?: string; from: unknown; to: unknown; stroke?: string; strokeWidth?: number; label?: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `line_${nanoid(8)}`, type: 'line', x: 0, y: 0, from: input.from, to: input.to, stroke: input.stroke, strokeWidth: input.strokeWidth, label: input.label } }] }),
    canvas_add_arrow: (input: { canvasId: string; id?: string; from: unknown; to: unknown; stroke?: string; strokeWidth?: number; label?: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `arrow_${nanoid(8)}`, type: 'arrow', x: 0, y: 0, from: input.from, to: input.to, stroke: input.stroke, strokeWidth: input.strokeWidth, label: input.label } }] }),
    canvas_add_table: (input: { canvasId: string; id?: string; columns: string[]; rows: string[][]; x: number; y: number; width?: number; height?: number; caption?: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'upsertElement', element: { id: input.id ?? `table_${nanoid(8)}`, type: 'table', columns: input.columns, rows: input.rows, x: input.x, y: input.y, width: input.width, height: input.height, caption: input.caption } }] }),
    canvas_update_element: (input: { canvasId: string; elementId: string; patch: Record<string, unknown> }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'patchElement', elementId: input.elementId, patch: input.patch }] }),
    canvas_delete_element: (input: { canvasId: string; elementId: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'deleteElement', elementId: input.elementId }] }),
    canvas_clear: (input: { canvasId: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/elements:batch`, { operations: [{ op: 'clear' }] }),
    canvas_get_viewport: (input: { canvasId: string }) => get(`/api/canvases/${encodeURIComponent(input.canvasId)}/viewport`),
    canvas_set_viewport: (input: { canvasId: string; centerX?: number; centerY?: number; zoom?: number; width?: number; height?: number }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/viewport/focus`, { centerX: input.centerX, centerY: input.centerY, zoom: input.zoom, width: input.width, height: input.height }),
    canvas_screenshot: (input: { canvasId: string; width?: number; height?: number; centerX?: number; centerY?: number; zoom?: number; fullCanvas?: boolean; overlayNodeIds?: boolean; padding?: number }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/screenshot`, { width: input.width, height: input.height, centerX: input.centerX, centerY: input.centerY, zoom: input.zoom, fullCanvas: input.fullCanvas, overlayNodeIds: input.overlayNodeIds, padding: input.padding })
  };
}
