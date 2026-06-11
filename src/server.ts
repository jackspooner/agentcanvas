import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AgentCanvasConfig } from './config';
import { toCanvasError } from './errors';
import { coerceScreenshotOptions, renderCanvasScreenshotSvg, screenshotDataUrl } from './screenshot';
import { SqliteCanvasStore } from './store/sqlite';
import { resolveAssetContentUrl, resolveAssetRecordUrl } from './validation';
import type { AssetElement, CanvasElement, CanvasRecord, GlbViewerElement } from './contracts';

export interface CreateAppOptions {
  store?: SqliteCanvasStore;
  config?: Partial<AgentCanvasConfig>;
}

function links(config: AgentCanvasConfig, canvasId: string) {
  return { view: `${config.publicBaseUrl}/canvases/${canvasId}` };
}

function proxiedAssetContentUrl(_config: AgentCanvasConfig, ref: { project: string; assetId: string }): string {
  return `/api/assets/${encodeURIComponent(ref.project)}/${encodeURIComponent(ref.assetId)}/content`;
}

function projectAssetUrls(canvas: CanvasRecord, config: AgentCanvasConfig): CanvasRecord {
  return {
    ...canvas,
    elements: canvas.elements.map((el: CanvasElement) => {
      if (el.type === 'asset') {
        const asset = el as AssetElement;
        return { ...asset, resolvedUrl: resolveAssetContentUrl(asset.assetRef, config.assetsBaseUrl) };
      }
      if (el.type === 'glbViewer') {
        const asset = el as GlbViewerElement;
        return { ...asset, resolvedUrl: proxiedAssetContentUrl(config, asset.assetRef) };
      }
      return el;
    })
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

function isAllowedGlbProxyContent(asset: Record<string, unknown>, upstreamContentType: string | null): boolean {
  const declared = headerContentType(typeof asset.content_type === 'string' ? asset.content_type : null);
  const upstream = headerContentType(upstreamContentType);
  const ext = filenameExt(asset.filename);
  const expectedModelType = declared === 'model/gltf-binary' || declared === 'model/gltf+json' || upstream === 'model/gltf-binary' || upstream === 'model/gltf+json';
  if (expectedModelType) return true;
  const octetStream = upstream === 'application/octet-stream' || declared === 'application/octet-stream' || (!upstream && !declared);
  return (ext === '.glb' || ext === '.gltf') && octetStream;
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
      markdown: true,
      sqlite: true,
      dedicated_mcp: true,
      viewport_control: true,
      screenshots: true,
      screenshot_node_id_overlay: true
    },
    host: config.host,
    port: config.port,
    assetBaseUrl: config.assetsBaseUrl
  }));

  app.get('/openapi.json', (c) => c.json({
    openapi: '3.1.0',
    info: { title: 'AgentCanvas API', version: '0.1.0' },
    paths: {
      '/health': { get: { summary: 'Health check' } },
      '/whoami': { get: { summary: 'Service capabilities' } },
      '/api/canvases': { get: { summary: 'List canvases' }, post: { summary: 'Create canvas' } },
      '/api/canvases/{canvasId}': { get: { summary: 'Get canvas' } },
      '/api/canvases/{canvasId}/elements:batch': { post: { summary: 'Apply element operations' } },
      '/api/assets/{project}/{assetId}/content': { get: { summary: 'Proxy asset bytes for same-origin GLB viewers' } },
      '/api/canvases/{canvasId}/share-links': { post: { summary: 'Create read-only share link' } },
      '/api/canvases/{canvasId}/viewport': { get: { summary: 'Get user and agent viewport state' }, post: { summary: 'Record browser/user viewport state' } },
      '/api/canvases/{canvasId}/viewport/focus': { post: { summary: 'Set agent-controlled viewport focus' } },
      '/api/canvases/{canvasId}/screenshot': { post: { summary: 'Render a canvas screenshot SVG' } },
      '/api/canvases/{canvasId}/screenshots/{filename}': { get: { summary: 'Fetch a rendered canvas screenshot SVG' } }
    }
  }));

  app.get('/api/canvases', (c) => {
    const project = c.req.query('project');
    const conversationId = c.req.query('conversationId');
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
    const canvases = store.listCanvases({ project, conversationId, limit }).map((canvas) => projectAssetUrls(canvas, config));
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
    return c.json({ ok: true, canvas: projectAssetUrls(canvas, config), links: responseLinks }, 201);
  });

  app.get('/api/canvases/:canvasId', (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    return c.json({ ok: true, canvas: projectAssetUrls(canvas, config), links: links(config, canvas.id) });
  });

  app.patch('/api/canvases/:canvasId', async (c) => {
    const existing = store.getCanvas(c.req.param('canvasId'));
    return c.json({ ok: true, canvas: projectAssetUrls(existing, config), links: links(config, existing.id), warning: 'patch metadata is not implemented in V1; use element batch operations' });
  });

  app.post('/api/canvases/:canvasId/elements:batch', async (c) => {
    const body = await c.req.json();
    const canvas = store.applyOperations(c.req.param('canvasId'), body);
    return c.json({ ok: true, canvas: projectAssetUrls(canvas, config), revision: canvas.revision, links: links(config, canvas.id) });
  });

  app.get('/api/assets/:project/:assetId/content', async (c) => {
    const project = c.req.param('project');
    const assetId = c.req.param('assetId');
    const ref = { type: 'asset' as const, project, assetId };
    const assetResponse = await fetch(resolveAssetRecordUrl(ref, config.assetsBaseUrl));
    if (!assetResponse.ok) {
      return c.json({ code: 'asset_proxy_failed', message: `asset metadata fetch failed: ${assetResponse.status}` }, assetResponse.status as 400 | 404 | 500);
    }
    const asset = await assetResponse.json().catch(() => null) as Record<string, unknown> | null;
    if (!asset || typeof asset !== 'object') {
      return c.json({ code: 'asset_proxy_failed', message: 'asset metadata response was invalid' }, 502);
    }

    const upstream = await fetch(resolveAssetContentUrl(ref, config.assetsBaseUrl));
    if (!upstream.ok) {
      return c.json({ code: 'asset_proxy_failed', message: `asset fetch failed: ${upstream.status}` }, upstream.status as 400 | 404 | 500);
    }
    if (!isAllowedGlbProxyContent(asset, upstream.headers.get('content-type'))) {
      await upstream.body?.cancel().catch(() => undefined);
      return c.json({ code: 'unsupported_asset_type', message: 'only GLB/glTF assets can be proxied through this endpoint' }, 415);
    }
    const headers = new Headers();
    const contentType = upstream.headers.get('content-type') || (filenameExt(asset.filename) === '.gltf' ? 'model/gltf+json' : 'model/gltf-binary');
    const contentLength = upstream.headers.get('content-length');
    headers.set('content-type', contentType);
    if (contentLength) headers.set('content-length', contentLength);
    headers.set('cache-control', 'private, max-age=60');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(upstream.body, { status: upstream.status, headers });
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

  app.get('/api/share/:token', (c) => {
    const resolved = store.resolveShareToken(c.req.param('token'));
    return c.json({ ok: true, link: resolved.link, canvas: projectAssetUrls(resolved.canvas, config), readOnly: true });
  });

  app.get('/canvases', (c) => c.html(appShell('AgentCanvas')));
  app.get('/canvases/:canvasId', (c) => c.html(appShell('AgentCanvas')));
  app.get('/c/:shareToken', (c) => c.html(appShell('AgentCanvas Share')));

  return app;
}

async function main() {
  const config = loadConfig();
  const app = createApp({ config });
  serve({ fetch: app.fetch, hostname: config.host, port: config.port });
  console.log(`AgentCanvas listening on ${config.publicBaseUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
