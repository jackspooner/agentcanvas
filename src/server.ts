import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AgentCanvasConfig } from './config';
import { toCanvasError } from './errors';
import { SqliteCanvasStore } from './store/sqlite';
import { resolveAssetContentUrl } from './validation';
import type { AssetElement, CanvasElement, CanvasRecord } from './contracts';

export interface CreateAppOptions {
  store?: SqliteCanvasStore;
  config?: Partial<AgentCanvasConfig>;
}

function links(config: AgentCanvasConfig, canvasId: string) {
  return { view: `${config.publicBaseUrl}/canvases/${canvasId}` };
}

function projectAssetUrls(canvas: CanvasRecord, config: AgentCanvasConfig): CanvasRecord {
  return {
    ...canvas,
    elements: canvas.elements.map((el: CanvasElement) => {
      if (el.type !== 'asset') return el;
      const asset = el as AssetElement;
      return { ...asset, resolvedUrl: resolveAssetContentUrl(asset.assetRef, config.assetsBaseUrl) };
    })
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
      markdown: true,
      sqlite: true,
      dedicated_mcp: true,
      viewport_control: true
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
      '/api/canvases/{canvasId}/share-links': { post: { summary: 'Create read-only share link' } },
      '/api/canvases/{canvasId}/viewport': { get: { summary: 'Get user and agent viewport state' }, post: { summary: 'Record browser/user viewport state' } },
      '/api/canvases/{canvasId}/viewport/focus': { post: { summary: 'Set agent-controlled viewport focus' } }
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
