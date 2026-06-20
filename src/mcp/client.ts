import { nanoid } from 'nanoid';

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type ResponseMode = 'compact' | 'full';

export interface McpHandlerOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

interface ResponseModeInput {
  mode?: ResponseMode;
}

interface CanvasGetInput extends ResponseModeInput {
  canvasId: string;
  elementLimit?: number;
}

interface ScreenshotInput {
  canvasId: string;
  width?: number;
  height?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  fullCanvas?: boolean;
  overlayNodeIds?: boolean;
  padding?: number;
  includeDataUrl?: boolean;
}

async function readJson(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message ?? `AgentCanvas HTTP ${response.status}`);
  return body;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanObject<T extends JsonRecord>(value: T): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function snippet(value: unknown, maxLength = 180): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function normalizeElementLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(500, Math.floor(value)));
}

function compactAssetRef(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  return cleanObject({
    type: stringValue(value.type),
    project: stringValue(value.project),
    assetId: stringValue(value.assetId),
    assetBaseUrl: stringValue(value.assetBaseUrl)
  });
}

function compactElement(value: unknown): JsonRecord {
  if (!isRecord(value)) return { value };
  const type = stringValue(value.type);
  return cleanObject({
    id: stringValue(value.id),
    type,
    x: numberValue(value.x),
    y: numberValue(value.y),
    width: numberValue(value.width),
    height: numberValue(value.height),
    caption: snippet(value.caption),
    alt: snippet(value.alt),
    label: snippet(value.label),
    textSnippet: snippet(value.text),
    markdownSnippet: snippet(value.markdown),
    columns: Array.isArray(value.columns) ? value.columns.slice(0, 12) : undefined,
    rowCount: Array.isArray(value.rows) ? value.rows.length : undefined,
    pathCount: Array.isArray(value.paths) ? value.paths.length : undefined,
    assetRef: compactAssetRef(value.assetRef),
    imageAssetRef: compactAssetRef(value.imageAssetRef),
    layoutAssetRef: compactAssetRef(value.layoutAssetRef),
    resolvedUrl: stringValue(value.resolvedUrl)
  });
}

function compactCanvasResult(result: unknown, input: { elementLimit?: number } = {}) {
  if (!isRecord(result) || !isRecord(result.canvas)) return result;
  const elements = Array.isArray(result.canvas.elements) ? result.canvas.elements : [];
  const elementLimit = normalizeElementLimit(input.elementLimit);
  const returnedElements = elements.slice(0, elementLimit);
  return {
    ...result,
    canvas: cleanObject({
      id: stringValue(result.canvas.id),
      title: stringValue(result.canvas.title),
      description: snippet(result.canvas.description, 300),
      project: stringValue(result.canvas.project),
      conversationId: stringValue(result.canvas.conversationId),
      width: numberValue(result.canvas.width),
      height: numberValue(result.canvas.height),
      revision: numberValue(result.canvas.revision),
      createdAt: stringValue(result.canvas.createdAt),
      updatedAt: stringValue(result.canvas.updatedAt),
      elementCount: elements.length,
      returnedElements: returnedElements.length,
      truncated: elements.length > returnedElements.length,
      elements: returnedElements.map(compactElement)
    })
  };
}

function compactCanvasSummary(value: unknown): JsonRecord {
  if (!isRecord(value)) return { value };
  const elements = Array.isArray(value.elements) ? value.elements : [];
  return cleanObject({
    id: stringValue(value.id),
    title: stringValue(value.title),
    description: snippet(value.description, 300),
    project: stringValue(value.project),
    conversationId: stringValue(value.conversationId),
    width: numberValue(value.width),
    height: numberValue(value.height),
    revision: numberValue(value.revision),
    createdAt: stringValue(value.createdAt),
    updatedAt: stringValue(value.updatedAt),
    elementCount: elements.length
  });
}

function compactCanvasListResult(result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.canvases)) return result;
  return {
    ...result,
    canvases: result.canvases.map(compactCanvasSummary)
  };
}

function changedElementIdsFromOperations(operations: JsonRecord[]): string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    const elementId = stringValue(operation.elementId);
    if (elementId) ids.add(elementId);
    if (isRecord(operation.element)) {
      const id = stringValue(operation.element.id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function compactMutationResult(result: unknown, canvasId: string, operations: JsonRecord[]) {
  if (!isRecord(result)) return result;
  const canvas = isRecord(result.canvas) ? result.canvas : {};
  return cleanObject({
    ok: result.ok,
    canvasId: stringValue(canvas.id) ?? canvasId,
    revision: numberValue(result.revision) ?? numberValue(canvas.revision),
    changedElementIds: changedElementIdsFromOperations(operations),
    links: isRecord(result.links) ? result.links : undefined,
    warnings: Array.isArray(result.warnings) ? result.warnings : undefined,
    overlapWarnings: Array.isArray(result.overlapWarnings) ? result.overlapWarnings : undefined
  });
}

function compactScreenshotResult(result: unknown, includeDataUrl: boolean | undefined) {
  if (includeDataUrl || !isRecord(result) || !isRecord(result.screenshot)) return result;
  const { dataUrl: _dataUrl, ...screenshot } = result.screenshot;
  return { ...result, screenshot };
}

export function createCanvasMcpHandlers(options: McpHandlerOptions = {}) {
  const baseUrl = (options.baseUrl ?? process.env.AGENT_CANVAS_BASE_URL ?? 'http://127.0.0.1:23003').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const post = (path: string, body: unknown) => fetchImpl(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(readJson);
  const get = (path: string) => fetchImpl(`${baseUrl}${path}`).then(readJson);
  const postElementsBatch = async (canvasId: string, operations: JsonRecord[], mode: ResponseMode | undefined) => {
    const result = await post(`/api/canvases/${encodeURIComponent(canvasId)}/elements:batch`, { operations });
    return mode === 'full' ? result : compactMutationResult(result, canvasId, operations);
  };

  return {
    canvas_create: (input: Record<string, unknown>) => post('/api/canvases', { createShareLink: true, ...input }),
    canvas_list: (input: Record<string, unknown> = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null) params.set(k, String(v));
      return get(`/api/canvases${params.size ? `?${params}` : ''}`).then(compactCanvasListResult);
    },
    canvas_get: async (input: CanvasGetInput) => {
      const result = await get(`/api/canvases/${encodeURIComponent(input.canvasId)}`);
      return input.mode === 'full' ? result : compactCanvasResult(result, input);
    },
    canvas_get_link: (input: { canvasId: string; label?: string }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/share-links`, { mode: 'read', label: input.label }),
    canvas_add_text: (input: { canvasId: string; id?: string; text: string; x: number; y: number; width?: number; height?: number; style?: unknown; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `text_${nanoid(8)}`, type: 'text', text: input.text, x: input.x, y: input.y, width: input.width, height: input.height, style: input.style } }], input.mode),
    canvas_add_markdown: (input: { canvasId: string; id?: string; markdown: string; x: number; y: number; width?: number; height?: number; style?: unknown; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `markdown_${nanoid(8)}`, type: 'markdown', markdown: input.markdown, x: input.x, y: input.y, width: input.width, height: input.height, style: input.style } }], input.mode),
    canvas_place_asset: (input: { canvasId: string; id?: string; assetRef: unknown; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; fit?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `asset_${nanoid(8)}`, type: 'asset', assetRef: input.assetRef, x: input.x, y: input.y, width: input.width, height: input.height, caption: input.caption, alt: input.alt, fit: input.fit } }], input.mode),
    canvas_place_glb_viewer: (input: { canvasId: string; id?: string; assetRef: unknown; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; cameraControls?: boolean; autoRotate?: boolean; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `glb_${nanoid(8)}`, type: 'glbViewer', assetRef: input.assetRef, x: input.x, y: input.y, width: input.width ?? 320, height: input.height ?? 240, caption: input.caption, alt: input.alt, cameraControls: input.cameraControls, autoRotate: input.autoRotate } }], input.mode),
    canvas_place_video: (input: { canvasId: string; id?: string; assetRef: unknown; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; controls?: boolean; autoplay?: boolean; loop?: boolean; muted?: boolean; posterAssetRef?: unknown; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `video_${nanoid(8)}`, type: 'video', assetRef: input.assetRef, x: input.x, y: input.y, width: input.width ?? 480, height: input.height ?? 270, caption: input.caption, alt: input.alt, controls: input.controls, autoplay: input.autoplay, loop: input.loop, muted: input.muted, posterAssetRef: input.posterAssetRef } }], input.mode),
    canvas_add_bbox_overlay: (input: { canvasId: string; id?: string; imageAssetRef?: unknown; layoutAssetRef?: unknown; canvasWidth?: number; canvasHeight?: number; boxes?: unknown[]; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; showLabels?: boolean; background?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: cleanObject({ id: input.id ?? `bbox_${nanoid(8)}`, type: 'bboxOverlay', imageAssetRef: input.imageAssetRef, layoutAssetRef: input.layoutAssetRef, canvasWidth: input.canvasWidth, canvasHeight: input.canvasHeight, boxes: input.boxes, x: input.x, y: input.y, width: input.width ?? 480, height: input.height ?? 320, caption: input.caption, alt: input.alt, showLabels: input.showLabels, background: input.background }) }], input.mode),
    canvas_add_bbox_overlay_from_asset: (input: { canvasId: string; id?: string; layoutAssetRef: unknown; imageAssetRef?: unknown; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; showLabels?: boolean; background?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: cleanObject({ id: input.id ?? `bbox_${nanoid(8)}`, type: 'bboxOverlay', layoutAssetRef: input.layoutAssetRef, imageAssetRef: input.imageAssetRef, x: input.x, y: input.y, width: input.width ?? 480, height: input.height ?? 320, caption: input.caption, alt: input.alt, showLabels: input.showLabels, background: input.background }) }], input.mode),
    canvas_add_path_overlay: (input: { canvasId: string; id?: string; canvasWidth: number; canvasHeight: number; paths: unknown[]; x: number; y: number; width?: number; height?: number; caption?: string; alt?: string; showLabels?: boolean; background?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `path_${nanoid(8)}`, type: 'pathOverlay', canvasWidth: input.canvasWidth, canvasHeight: input.canvasHeight, paths: input.paths, x: input.x, y: input.y, width: input.width ?? 480, height: input.height ?? 320, caption: input.caption, alt: input.alt, showLabels: input.showLabels, background: input.background } }], input.mode),
    canvas_add_line: (input: { canvasId: string; id?: string; from: unknown; to: unknown; stroke?: string; strokeWidth?: number; label?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `line_${nanoid(8)}`, type: 'line', x: 0, y: 0, from: input.from, to: input.to, stroke: input.stroke, strokeWidth: input.strokeWidth, label: input.label } }], input.mode),
    canvas_add_arrow: (input: { canvasId: string; id?: string; from: unknown; to: unknown; stroke?: string; strokeWidth?: number; label?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `arrow_${nanoid(8)}`, type: 'arrow', x: 0, y: 0, from: input.from, to: input.to, stroke: input.stroke, strokeWidth: input.strokeWidth, label: input.label } }], input.mode),
    canvas_add_table: (input: { canvasId: string; id?: string; columns: string[]; rows: string[][]; x: number; y: number; width?: number; height?: number; caption?: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'upsertElement', element: { id: input.id ?? `table_${nanoid(8)}`, type: 'table', columns: input.columns, rows: input.rows, x: input.x, y: input.y, width: input.width, height: input.height, caption: input.caption } }], input.mode),
    canvas_update_element: (input: { canvasId: string; elementId: string; patch: Record<string, unknown>; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'patchElement', elementId: input.elementId, patch: input.patch }], input.mode),
    canvas_delete_element: (input: { canvasId: string; elementId: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'deleteElement', elementId: input.elementId }], input.mode),
    canvas_clear: (input: { canvasId: string; mode?: ResponseMode }) => postElementsBatch(input.canvasId, [{ op: 'clear' }], input.mode),
    canvas_get_viewport: (input: { canvasId: string }) => get(`/api/canvases/${encodeURIComponent(input.canvasId)}/viewport`),
    canvas_set_viewport: (input: { canvasId: string; centerX?: number; centerY?: number; zoom?: number; width?: number; height?: number }) => post(`/api/canvases/${encodeURIComponent(input.canvasId)}/viewport/focus`, { centerX: input.centerX, centerY: input.centerY, zoom: input.zoom, width: input.width, height: input.height }),
    canvas_screenshot: async (input: ScreenshotInput) => {
      const result = await post(`/api/canvases/${encodeURIComponent(input.canvasId)}/screenshot`, { width: input.width, height: input.height, centerX: input.centerX, centerY: input.centerY, zoom: input.zoom, fullCanvas: input.fullCanvas, overlayNodeIds: input.overlayNodeIds, padding: input.padding });
      return compactScreenshotResult(result, input.includeDataUrl);
    }
  };
}
