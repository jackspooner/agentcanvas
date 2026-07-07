import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AgentCanvasConfig } from './config';
import { toCanvasError } from './errors';
import { changedElementIdsFromOperations, computeOverlapWarnings } from './geometry';
import { coerceScreenshotOptions, renderCanvasScreenshotSvg, screenshotDataUrl } from './screenshot';
import { SqliteCanvasStore } from './store/sqlite';
import { normalizeBBoxLayoutAssetDocument } from './bboxLayoutAssets';
import { resolveAssetContentUrl, resolveAssetRecordUrl, validateAssetRef } from './validation';
import type { AssetElement, AssetReference, BBoxOverlayElement, CanvasElement, CanvasRecord, GlbViewerElement, VideoElement } from './contracts';
import { handleAgentCanvasMcpRequest } from './mcp/http';

export interface CreateAppOptions {
  store?: SqliteCanvasStore;
  config?: Partial<AgentCanvasConfig>;
}

function links(config: AgentCanvasConfig, canvasId: string) {
  return { view: `${config.publicBaseUrl}/canvases/${canvasId}` };
}

function proxiedAssetContentUrl(_config: AgentCanvasConfig, ref: AssetReference): string {
  const checked = validateAssetRef(ref);
  if (checked.assetId) return `/api/assets/${encodeURIComponent(checked.project)}/${encodeURIComponent(checked.assetId)}/content`;
  return `/api/assets/${encodeURIComponent(checked.project)}/by-key/content?assetKey=${encodeURIComponent(checked.assetKey ?? '')}`;
}

async function resolveBBoxOverlayElement(overlay: BBoxOverlayElement, config: AgentCanvasConfig): Promise<BBoxOverlayElement> {
  const layoutResolvedUrl = overlay.layoutAssetRef ? resolveAssetRecordUrl(overlay.layoutAssetRef, config.assetsBaseUrl) : null;
  if (!overlay.layoutAssetRef) {
    return {
      ...overlay,
      imageResolvedUrl: overlay.imageAssetRef ? proxiedAssetContentUrl(config, overlay.imageAssetRef) : null,
      layoutResolvedUrl,
      layoutSchema: null,
      layoutResolutionError: null
    };
  }

  try {
    const response = await fetch(resolveAssetContentUrl(overlay.layoutAssetRef, config.assetsBaseUrl));
    if (!response.ok) {
      throw new Error(`layout asset fetch failed: ${response.status}`);
    }
    const content = await response.json().catch(() => null);
    const layout = normalizeBBoxLayoutAssetDocument(content, { validateAssetRef });
    const imageAssetRef = overlay.imageAssetRef ?? layout.imageAssetRef ?? null;
    return {
      ...overlay,
      canvasWidth: layout.canvasWidth,
      canvasHeight: layout.canvasHeight,
      boxes: layout.boxes,
      imageAssetRef,
      imageResolvedUrl: imageAssetRef ? proxiedAssetContentUrl(config, imageAssetRef) : null,
      caption: overlay.caption ?? layout.caption,
      alt: overlay.alt ?? layout.alt,
      showLabels: overlay.showLabels ?? layout.showLabels ?? true,
      background: overlay.background ?? layout.background,
      layoutResolvedUrl,
      layoutSchema: layout.schema,
      layoutResolutionError: null
    };
  } catch (error) {
    return {
      ...overlay,
      imageResolvedUrl: overlay.imageAssetRef ? proxiedAssetContentUrl(config, overlay.imageAssetRef) : null,
      layoutResolvedUrl,
      layoutSchema: null,
      layoutResolutionError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function projectAssetUrls(canvas: CanvasRecord, config: AgentCanvasConfig): Promise<CanvasRecord> {
  return {
    ...canvas,
    elements: await Promise.all(canvas.elements.map(async (el: CanvasElement) => {
      if (el.type === 'asset') {
        const asset = el as AssetElement;
        return { ...asset, resolvedUrl: resolveAssetContentUrl(asset.assetRef, config.assetsBaseUrl) };
      }
      if (el.type === 'glbViewer') {
        const asset = el as GlbViewerElement;
        return { ...asset, resolvedUrl: proxiedAssetContentUrl(config, asset.assetRef) };
      }
      if (el.type === 'video') {
        const asset = el as VideoElement;
        return {
          ...asset,
          resolvedUrl: proxiedAssetContentUrl(config, asset.assetRef),
          posterResolvedUrl: asset.posterAssetRef ? proxiedAssetContentUrl(config, asset.posterAssetRef) : null
        };
      }
      if (el.type === 'bboxOverlay') {
        return resolveBBoxOverlayElement(el as BBoxOverlayElement, config);
      }
      return el;
    }))
  };
}

function screenshotDirectory(config: AgentCanvasConfig): string {
  return path.join(path.dirname(config.databasePath), 'screenshots');
}

function screenshotFilename(canvasId: string, revision: number): string {
  const safeCanvasId = canvasId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeCanvasId}-rev${revision}-${Date.now()}.svg`;
}

function headerContentType(value: string | null): string {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function filenameExt(value: unknown): string {
  if (typeof value !== 'string') return '';
  const basename = path.basename(value).toLowerCase();
  return path.extname(basename);
}

function isSafeProxyContentType(value: string): boolean {
  if (value === 'model/gltf-binary' || value === 'model/gltf+json') return true;
  if (value.startsWith('video/')) return true;
  return new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']).has(value);
}

function isProxyOctetOrMissing(value: string): boolean {
  return value === '' || value === 'application/octet-stream';
}

function isAllowedProxyContent(asset: Record<string, unknown>, upstreamContentType: string | null): boolean {
  const declared = headerContentType(typeof asset.content_type === 'string' ? asset.content_type : null);
  const upstream = headerContentType(upstreamContentType);
  const ext = filenameExt(asset.filename);
  if (!isProxyOctetOrMissing(declared) && !isSafeProxyContentType(declared)) return false;
  if (!isProxyOctetOrMissing(upstream) && !isSafeProxyContentType(upstream)) return false;
  if (isSafeProxyContentType(upstream)) return true;
  const safeExtension = ['.glb', '.gltf', '.mp4', '.webm', '.mov', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext);
  return safeExtension && (isSafeProxyContentType(declared) || isProxyOctetOrMissing(declared));
}

function fallbackContentTypeForAsset(asset: Record<string, unknown>): string {
  const ext = filenameExt(asset.filename);
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  return 'model/gltf-binary';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface RasterDimensions {
  width: number;
  height: number;
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint24LE(view: DataView, offset: number): number {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
}

function readPngDimensions(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readGifDimensions(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 10) return null;
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: readUint16LE(view, 6), height: readUint16LE(view, 8) };
}

function readWebpDimensions(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 30) return null;
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 12));
  if (!header.startsWith('RIFF') || header.slice(8, 12) !== 'WEBP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = new TextDecoder('ascii').decode(bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { width: readUint24LE(view, 24) + 1, height: readUint24LE(view, 27) + 1 };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + ((b3 << 6) | (b2 >> 2) | ((b1 & 0xc0) << 6))
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    // Lossy VP8 stores dimensions in the frame header after the chunk header/size.
    return { width: readUint16LE(view, 26) & 0x3fff, height: readUint16LE(view, 28) & 0x3fff };
  }
  return null;
}

function readJpegDimensions(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 4 > bytes.length) return null;
    const length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const isSof = (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker));
    if (isSof && length >= 7) {
      return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false) };
    }
    offset += 2 + length;
  }
  return null;
}

function readRasterDimensions(buffer: ArrayBuffer): RasterDimensions | null {
  const bytes = new Uint8Array(buffer);
  return readPngDimensions(bytes) ?? readGifDimensions(bytes) ?? readWebpDimensions(bytes) ?? readJpegDimensions(bytes);
}

async function fetchRasterDimensions(ref: AssetReference, asset: Record<string, unknown>, config: AgentCanvasConfig): Promise<RasterDimensions | null> {
  const declared = headerContentType(typeof asset.content_type === 'string' ? asset.content_type : null);
  const ext = filenameExt(asset.filename);
  const maybeRaster = declared.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
  if (!maybeRaster) return null;
  const response = await fetch(resolveAssetContentUrl(ref, config.assetsBaseUrl));
  if (!response.ok || !isAllowedProxyContent(asset, response.headers.get('content-type'))) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const buffer = await response.arrayBuffer();
  return readRasterDimensions(buffer);
}

async function assetDetailsResponse(ref: AssetReference, config: AgentCanvasConfig): Promise<Response> {
  const assetResponse = await fetch(resolveAssetRecordUrl(ref, config.assetsBaseUrl));
  if (!assetResponse.ok) {
    return Response.json({ code: 'asset_details_failed', message: `asset metadata fetch failed: ${assetResponse.status}` }, { status: assetResponse.status });
  }
  const asset = await assetResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!asset || typeof asset !== 'object') {
    return Response.json({ code: 'asset_details_failed', message: 'asset metadata response was invalid' }, { status: 502 });
  }
  const preliminary = normalizeAssetDetails(asset, config);
  const preliminaryAsset = isRecord(preliminary.asset) ? preliminary.asset : {};
  if (typeof preliminaryAsset.width === 'number' && typeof preliminaryAsset.height === 'number') {
    return Response.json(preliminary);
  }
  const measuredDimensions = await fetchRasterDimensions(ref, asset, config).catch(() => null);
  return Response.json(normalizeAssetDetails(asset, config, measuredDimensions));
}

async function assetContentProxyResponse(ref: AssetReference, config: AgentCanvasConfig): Promise<Response> {
  const assetResponse = await fetch(resolveAssetRecordUrl(ref, config.assetsBaseUrl));
  if (!assetResponse.ok) {
    return Response.json({ code: 'asset_proxy_failed', message: `asset metadata fetch failed: ${assetResponse.status}` }, { status: assetResponse.status });
  }
  const asset = await assetResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!asset || typeof asset !== 'object') {
    return Response.json({ code: 'asset_proxy_failed', message: 'asset metadata response was invalid' }, { status: 502 });
  }

  const upstream = await fetch(resolveAssetContentUrl(ref, config.assetsBaseUrl));
  if (!upstream.ok) {
    return Response.json({ code: 'asset_proxy_failed', message: `asset fetch failed: ${upstream.status}` }, { status: upstream.status });
  }
  if (!isAllowedProxyContent(asset, upstream.headers.get('content-type'))) {
    await upstream.body?.cancel().catch(() => undefined);
    return Response.json({ code: 'unsupported_asset_type', message: 'only GLB/glTF, video, and safe raster image assets can be proxied through this endpoint' }, { status: 415 });
  }
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type') || fallbackContentTypeForAsset(asset);
  const contentLength = upstream.headers.get('content-length');
  headers.set('content-type', contentType);
  if (contentLength) headers.set('content-length', contentLength);
  headers.set('cache-control', 'private, max-age=60');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(upstream.body, { status: upstream.status, headers });
}

function byKeyRefFromRequest(project: string, assetKey: string | undefined): AssetReference {
  if (!assetKey) throw new Error('assetKey query parameter is required');
  return validateAssetRef({ type: 'asset', project, assetKey });
}

function looksSensitiveString(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\') || value.startsWith('data:') || value.length > 20_000;
}

function sanitizeDetailsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDetailsValue);
  if (!isRecord(value)) {
    if (typeof value === 'string' && looksSensitiveString(value)) return '[redacted]';
    return value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/api[_-]?key|authorization|token|secret|password/i.test(key)) continue;
    sanitized[key] = sanitizeDetailsValue(child);
  }
  return sanitized;
}

function sanitizeDetailsRecord(value: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeDetailsValue(value);
  return isRecord(sanitized) ? sanitized : null;
}

function normalizeContextImages(value: unknown, config: AgentCanvasConfig): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (isRecord(item) && item.type === 'asset' && typeof item.project === 'string' && typeof item.assetId === 'string') {
      const ref = { type: 'asset' as const, project: item.project, assetId: item.assetId, assetBaseUrl: typeof item.assetBaseUrl === 'string' ? item.assetBaseUrl : undefined };
      return {
        ...ref,
        resolvedUrl: proxiedAssetContentUrl(config, ref)
      };
    }
    return sanitizeDetailsValue(item);
  });
}

function normalizeGeneration(generation: Record<string, unknown>, config: AgentCanvasConfig): Record<string, unknown> {
  const settings = isRecord(generation.settings) ? generation.settings : {};
  const size = isRecord(settings.size) ? settings.size : {};
  return {
    service: generation.service ?? null,
    tool: generation.tool ?? null,
    provider: generation.provider ?? null,
    model: generation.model ?? null,
    quality: settings.quality ?? null,
    width: readNumber(size.width),
    height: readNumber(size.height),
    prompt: generation.prompt ?? null,
    jsonPrompt: sanitizeDetailsValue(generation.jsonPrompt ?? null),
    contextImages: normalizeContextImages(generation.contextImages, config),
    controls: sanitizeDetailsRecord(settings.controls) ?? {},
    providerRequest: sanitizeDetailsRecord(generation.providerRequest),
    requestId: generation.requestId ?? null,
    imageIndex: generation.imageIndex ?? null,
    generatedAt: generation.generatedAt ?? null
  };
}

function normalizeCost(costValue: unknown): Record<string, unknown> | null {
  const cost = sanitizeDetailsRecord(costValue);
  if (!cost) return null;
  const amount = readNumber(cost.amount);
  const currency = typeof cost.currency === 'string' && cost.currency.trim() ? cost.currency.trim() : null;
  if (amount === null || amount < 0 || !currency) return null;
  return {
    currency,
    amount,
    estimated: typeof cost.estimated === 'boolean' ? cost.estimated : null,
    pricingSource: typeof cost.pricingSource === 'string' ? cost.pricingSource : null,
    pricingVersion: typeof cost.pricingVersion === 'string' ? cost.pricingVersion : null,
    calculatedAt: typeof cost.calculatedAt === 'string' ? cost.calculatedAt : null
  };
}

function normalizeAssetDetails(asset: Record<string, unknown>, config: AgentCanvasConfig, measuredDimensions?: RasterDimensions | null): Record<string, unknown> {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const generationRecord = isRecord(metadata.generation) ? metadata.generation : null;
  const normalizedGeneration = generationRecord ? normalizeGeneration(generationRecord, config) : null;
  const normalizedCost = normalizeCost(metadata.cost);
  const measuredWidth = readNumber(asset.image_width_px) ?? readNumber(isRecord(metadata.dimensions) ? metadata.dimensions.width : undefined) ?? readNumber(metadata.width) ?? measuredDimensions?.width ?? null;
  const measuredHeight = readNumber(asset.image_height_px) ?? readNumber(isRecord(metadata.dimensions) ? metadata.dimensions.height : undefined) ?? readNumber(metadata.height) ?? measuredDimensions?.height ?? null;
  const width = readNumber(normalizedGeneration?.width) ?? measuredWidth;
  const height = readNumber(normalizedGeneration?.height) ?? measuredHeight;
  const warnings = generationRecord ? [] : ['generation_not_recorded'];
  return {
    ok: true,
    asset: {
      project: asset.project ?? null,
      assetId: asset.id ?? null,
      filename: asset.filename ?? null,
      contentType: asset.content_type ?? null,
      sizeBytes: asset.size_bytes ?? null,
      contentSha256: asset.content_sha256 ?? null,
      width,
      height,
      createdAt: asset.created_at ?? null,
      updatedAt: asset.updated_at ?? null
    },
    generation: normalizedGeneration,
    cost: normalizedCost,
    warnings
  };
}

export function appShell(title = 'AgentCanvas', distRoot = path.resolve('dist', 'web')): string {
  const builtIndex = path.join(distRoot, 'index.html');
  if (fs.existsSync(builtIndex)) return fs.readFileSync(builtIndex, 'utf-8');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <script type="module" src="/src/web/main.tsx"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = loadConfig(options.config);
  const store = options.store ?? new SqliteCanvasStore(config.databasePath, config);
  const app = new Hono();

  app.onError((err, c) => {
    const e = toCanvasError(err);
    return c.json(e.toPayload(), e.status as 400 | 404 | 409 | 500);
  });

  app.use('/assets/*', serveStatic({ root: path.resolve('dist', 'web') }));

  app.get('/health', (c) => c.json({ ok: true, service: 'AgentCanvas' }));

  app.get('/whoami', (c) => c.json({
    service: 'AgentCanvas',
    version: '0.1.0',
    capabilities: {
      canvas_crud: true,
      share_links: true,
      asset_refs: true,
      glb_viewers: true,
      video_assets: true,
      bbox_overlays: true,
      path_overlays: true,
      markdown: true,
      sqlite: true,
      dedicated_mcp: true,
      viewport_control: true,
      screenshots: true,
      screenshot_node_id_overlay: true,
      resident_http_mcp: true,
      streamable_http_mcp: true
    },
    mcp: {
      endpoint: `${config.publicBaseUrl}/mcp`,
      transport: 'streamable-http',
      session: 'stateless',
      jsonResponse: true,
      stdioCompatible: true
    },
    host: config.host,
    port: config.port,
    assetBaseUrl: config.assetsBaseUrl
  }));

  app.get('/openapi.json', (c) => c.json({
    openapi: '3.1.0',
    info: { title: 'AgentCanvas API', version: '0.1.0' },
    paths: {
      '/': { get: { operationId: 'openCanvasChooser', summary: 'Canvas chooser web app' } },
      '/canvases': { get: { operationId: 'openCanvasChooserAlias', summary: 'Canvas chooser web app' } },
      '/canvases/{canvasId}': { get: { operationId: 'openCanvas', summary: 'Editable canvas web app' } },
      '/c/{shareToken}': { get: { operationId: 'openShareCanvas', summary: 'Read-only share canvas web app' } },
      '/health': { get: { operationId: 'getHealth', summary: 'Health check' } },
      '/whoami': { get: { operationId: 'getWhoami', summary: 'Service capabilities' } },
      '/mcp': { post: { operationId: 'postMcp', summary: 'Stateless streamable HTTP MCP endpoint for AgentCanvas tools' } },
      '/api/canvases': { get: { operationId: 'listCanvases', summary: 'List canvases' }, post: { operationId: 'createCanvas', summary: 'Create canvas' } },
      '/api/canvases/{canvasId}': {
        get: { operationId: 'getCanvas', summary: 'Get canvas' },
        patch: { operationId: 'patchCanvasMetadataV1', summary: 'V1 metadata patch placeholder' }
      },
      '/api/canvases/{canvasId}/elements:batch': { post: { operationId: 'applyCanvasElementBatch', summary: 'Apply element operations' } },
      '/api/assets/{project}/{assetId}/details': { get: { operationId: 'getAssetDetails', summary: 'Fetch normalized asset metadata, image generation provenance, and generation cost for UI display' } },
      '/api/assets/{project}/{assetId}/content': { get: { operationId: 'getAssetContent', summary: 'Proxy asset bytes for same-origin GLB viewers and video elements' } },
      '/api/assets/{project}/by-key/details': { get: { operationId: 'getAssetDetailsByKey', summary: 'Fetch normalized asset metadata by project-scoped assetKey query parameter' } },
      '/api/assets/{project}/by-key/content': { get: { operationId: 'getAssetContentByKey', summary: 'Proxy asset bytes by project-scoped assetKey query parameter' } },
      '/api/canvases/{canvasId}/share-links': { post: { operationId: 'createCanvasShareLink', summary: 'Create read-only share link' } },
      '/api/share/{token}': { get: { operationId: 'resolveShareLink', summary: 'Resolve a read-only share link token' } },
      '/api/canvases/{canvasId}/viewport': {
        get: { operationId: 'getCanvasViewport', summary: 'Get user and agent viewport state' },
        post: { operationId: 'recordCanvasViewport', summary: 'Record browser/user viewport state' }
      },
      '/api/canvases/{canvasId}/viewport/focus': { post: { operationId: 'setCanvasViewportFocus', summary: 'Set agent-controlled viewport focus' } },
      '/api/canvases/{canvasId}/screenshot': { post: { operationId: 'renderCanvasScreenshot', summary: 'Render a canvas screenshot SVG' } },
      '/api/canvases/{canvasId}/screenshots/{filename}': { get: { operationId: 'getCanvasScreenshot', summary: 'Fetch a rendered canvas screenshot SVG' } }
    }
  }));

  app.get('/api/canvases', async (c) => {
    const project = c.req.query('project');
    const conversationId = c.req.query('conversationId');
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
    const canvases = await Promise.all(store.listCanvases({ project, conversationId, limit }).map((canvas) => projectAssetUrls(canvas, config)));
    return c.json({ ok: true, canvases, links: { self: `${config.publicBaseUrl}/api/canvases` } });
  });

  app.post('/api/canvases', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const canvas = store.createCanvas(body);
    const responseLinks: Record<string, string> = links(config, canvas.id);
    if (body.createShareLink) {
      const share = store.createShareLink(canvas.id, { mode: 'read' });
      responseLinks.share = share.url;
    }
    return c.json({ ok: true, canvas: await projectAssetUrls(canvas, config), links: responseLinks }, 201);
  });

  app.get('/api/canvases/:canvasId', async (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    return c.json({ ok: true, canvas: await projectAssetUrls(canvas, config), links: links(config, canvas.id) });
  });

  app.patch('/api/canvases/:canvasId', async (c) => {
    const existing = store.getCanvas(c.req.param('canvasId'));
    return c.json({ ok: true, canvas: await projectAssetUrls(existing, config), links: links(config, existing.id), warning: 'patch metadata is not implemented in V1; use element batch operations' });
  });

  app.post('/api/canvases/:canvasId/elements:batch', async (c) => {
    const body = await c.req.json();
    const canvas = store.applyOperations(c.req.param('canvasId'), body);
    const overlapWarnings = computeOverlapWarnings(canvas, changedElementIdsFromOperations(body?.operations));
    const warnings = overlapWarnings.map((warning) => warning.message);
    return c.json({ ok: true, canvas: await projectAssetUrls(canvas, config), revision: canvas.revision, links: links(config, canvas.id), warnings, overlapWarnings });
  });

  app.get('/api/assets/:project/by-key/details', async (c) => {
    try {
      return assetDetailsResponse(byKeyRefFromRequest(c.req.param('project'), c.req.query('assetKey')), config);
    } catch (error) {
      return c.json({ code: 'invalid_asset_key', message: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get('/api/assets/:project/:assetId/details', async (c) => {
    const project = c.req.param('project');
    const assetId = c.req.param('assetId');
    return assetDetailsResponse({ type: 'asset' as const, project, assetId }, config);
  });

  app.get('/api/assets/:project/by-key/content', async (c) => {
    try {
      return assetContentProxyResponse(byKeyRefFromRequest(c.req.param('project'), c.req.query('assetKey')), config);
    } catch (error) {
      return c.json({ code: 'invalid_asset_key', message: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get('/api/assets/:project/:assetId/content', async (c) => {
    const project = c.req.param('project');
    const assetId = c.req.param('assetId');
    return assetContentProxyResponse({ type: 'asset' as const, project, assetId }, config);
  });

  app.post('/api/canvases/:canvasId/share-links', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const share = store.createShareLink(c.req.param('canvasId'), { ...body, mode: 'read' });
    return c.json({ ok: true, share: { id: share.id, mode: share.mode, url: share.url, canvasId: share.canvasId } }, 201);
  });

  app.get('/api/canvases/:canvasId/viewport', (c) => {
    const state = store.getViewportState(c.req.param('canvasId'));
    return c.json({ ok: true, ...state });
  });

  app.post('/api/canvases/:canvasId/viewport', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const viewport = store.recordViewport(c.req.param('canvasId'), { ...body, source: 'user' }, 'user');
    return c.json({ ok: true, viewport });
  });

  app.post('/api/canvases/:canvasId/viewport/focus', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const viewport = store.recordViewport(c.req.param('canvasId'), { ...body, source: 'agent' }, 'agent');
    return c.json({ ok: true, viewport });
  });

  app.post('/api/canvases/:canvasId/screenshot', async (c) => {
    const canvasId = c.req.param('canvasId');
    const canvas = store.getCanvas(canvasId);
    const body = await c.req.json().catch(() => ({}));
    const rendered = renderCanvasScreenshotSvg(canvas, coerceScreenshotOptions(body));
    const filename = screenshotFilename(canvas.id, canvas.revision);
    const dir = screenshotDirectory(config);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), rendered.svg, 'utf-8');
    const url = `${config.publicBaseUrl}/api/canvases/${encodeURIComponent(canvas.id)}/screenshots/${encodeURIComponent(filename)}`;
    return c.json({
      ok: true,
      screenshot: {
        format: 'svg',
        mimeType: 'image/svg+xml',
        width: rendered.width,
        height: rendered.height,
        viewBox: rendered.viewBox,
        overlayNodeIds: rendered.overlayNodeIds,
        dataUrl: screenshotDataUrl(rendered.svg),
        url
      }
    });
  });

  app.get('/api/canvases/:canvasId/screenshots/:filename', (c) => {
    const expectedPrefix = c.req.param('canvasId').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = path.basename(c.req.param('filename'));
    if (!filename.startsWith(`${expectedPrefix}-rev`) || !filename.endsWith('.svg')) {
      return c.json({ code: 'invalid_screenshot_name', message: 'invalid screenshot filename' }, 400);
    }
    const filePath = path.join(screenshotDirectory(config), filename);
    if (!fs.existsSync(filePath)) {
      return c.json({ code: 'screenshot_not_found', message: 'screenshot not found' }, 404);
    }
    return new Response(fs.readFileSync(filePath), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'private, max-age=300',
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'x-content-type-options': 'nosniff'
      }
    });
  });

  app.get('/api/share/:token', async (c) => {
    const resolved = store.resolveShareToken(c.req.param('token'));
    return c.json({ ok: true, link: resolved.link, canvas: await projectAssetUrls(resolved.canvas, config), readOnly: true });
  });

  app.get('/', (c) => c.html(appShell('AgentCanvas')));
  app.get('/canvases', (c) => c.html(appShell('AgentCanvas')));
  app.get('/canvases/:canvasId', (c) => c.html(appShell('AgentCanvas')));
  app.get('/c/:shareToken', (c) => c.html(appShell('AgentCanvas Share')));

  return app;
}

function createInternalAppFetch(app: ReturnType<typeof createApp>) {
  return async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    return app.request(`${parsed.pathname}${parsed.search}`, init);
  };
}

export function createAgentCanvasServiceHandler(options: CreateAppOptions = {}): RequestListener {
  const config = loadConfig(options.config);
  const store = options.store ?? new SqliteCanvasStore(config.databasePath, config);
  const app = createApp({ ...options, store, config });
  const honoHandler = getRequestListener(app.fetch, {
    hostname: config.host,
    overrideGlobalObjects: false
  });

  return async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', config.publicBaseUrl);
    if (requestUrl.pathname === '/mcp') {
      await handleAgentCanvasMcpRequest(request, response, {
        baseUrl: config.publicBaseUrl,
        fetchImpl: createInternalAppFetch(app)
      });
      return;
    }
    await honoHandler(request, response);
  };
}

async function main() {
  const { loadAgentCanvasDotenv } = await import('./dotenv');
  loadAgentCanvasDotenv();
  const config = loadConfig();
  const server = createServer(createAgentCanvasServiceHandler({ config }));
  server.listen(config.port, config.host, () => {
    console.log(`AgentCanvas listening on ${config.publicBaseUrl}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
