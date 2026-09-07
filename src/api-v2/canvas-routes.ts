import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Context, Hono } from 'hono';
import { canvasPageUrl } from '../canvas-url.js';
import { CanvasError } from '../errors.js';
import type { V2Runtime } from '../runtime.js';
import { collectSnapshotItems, composeSnapshot } from '../snapshot-runtime/index.js';
import { resolveCanvasProjection } from './canvas-projection.js';
import { CORE_REQUEST_SCHEMAS } from './schemas.js';
export function registerCanvasRoutes(app: Hono, runtime: V2Runtime): void {
  const { config, registry, resources, store } = runtime;
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const coreValidators = new Map<string, ValidateFunction>(
    Object.entries(CORE_REQUEST_SCHEMAS).map(([name, schema]) => [
      name,
      ajv.compile(
        JSON.parse(
          JSON.stringify({
            ...schema,
            $defs: (runtime.openapi.components as JsonObject).schemas
          }).replaceAll('#/components/schemas/', '#/$defs/')
        )
      )
    ])
  );
  async function readCoreJson<T>(c: Context, name: keyof typeof CORE_REQUEST_SCHEMAS): Promise<T> {
    let value: unknown;
    try {
      value = await c.req.json();
    } catch {
      throw new CanvasError('validation_error', 'Request body must be valid JSON', 'validation', 400);
    }
    const validate = coreValidators.get(name) as ValidateFunction;
    if (!validate(value)) {
      const issue = validate.errors?.[0];
      throw new CanvasError(
        'validation_error',
        `Request body${issue?.instancePath || '/'} ${issue?.message || 'does not match the canonical schema'}`,
        'validation',
        400
      );
    }
    return value as T;
  }
  app.get('/api/v1/configuration', (c) => c.json({ ok: true, configuration: store.getConfiguration() }));
  app.patch('/api/v1/configuration', async (c) =>
    c.json({ ok: true, configuration: store.updateConfiguration(await readCoreJson(c, 'configuration')) })
  );
  app.get('/api/v1/canvases', async (c) => {
    const canvases = store.listCanvases({
      project: c.req.query('project'),
      conversationId: c.req.query('conversationId'),
      limit: c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit'))
    });
    return c.json({ ok: true, canvases });
  });
  app.post('/api/v1/canvases', async (c) => {
    const canvas = store.createCanvas(await readCoreJson(c, 'create'));
    return c.json({ ok: true, canvas, url: canvasPageUrl(config.publicBaseUrl, canvas.id) }, 201);
  });
  app.get('/api/v1/canvases/:canvasId', async (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    const projection = await resolveCanvasProjection(canvas, registry, false, c.req.raw.signal);
    return c.json({ ok: true, canvas, ...projection });
  });
  app.patch('/api/v1/canvases/:canvasId', async (c) =>
    c.json({ ok: true, canvas: store.updateCanvasBounds(c.req.param('canvasId'), await readCoreJson(c, 'bounds')) })
  );
  app.patch('/api/v1/canvases/:canvasId/title', async (c) =>
    c.json({ ok: true, canvas: store.renameCanvas(c.req.param('canvasId'), await readCoreJson(c, 'title')) })
  );
  app.patch('/api/v1/canvases/:canvasId/theme', async (c) =>
    c.json({ ok: true, canvas: store.updateCanvasTheme(c.req.param('canvasId'), await readCoreJson(c, 'theme')) })
  );
  app.post('/api/v1/canvases/:canvasId/elements:batch', async (c) => {
    const canvas = store.applyOperations(c.req.param('canvasId'), await readCoreJson(c, 'batch'));
    const projection = await resolveCanvasProjection(canvas, registry, false, c.req.raw.signal);
    return c.json({ ok: true, canvas, revision: canvas.revision, ...projection });
  });
  app.post('/api/v1/canvases/:canvasId/share-links', async (c) => {
    const share = store.createShareLink(c.req.param('canvasId'), await readCoreJson(c, 'share'));
    const { token: _token, ...publicShare } = share;
    return c.json({ ok: true, share: publicShare }, 201);
  });
  app.get('/api/v1/canvases/:canvasId/share-links', (c) =>
    c.json({ ok: true, shareLinks: store.listShareLinks(c.req.param('canvasId')) })
  );
  app.delete('/api/v1/canvases/:canvasId/share-links/:shareLinkId', (c) =>
    c.json({ ok: true, shareLink: store.revokeShareLink(c.req.param('canvasId'), c.req.param('shareLinkId')) })
  );
  app.get('/api/v1/canvases/:canvasId/viewport', (c) =>
    c.json({ ok: true, ...store.getViewportState(c.req.param('canvasId')) })
  );
  app.post('/api/v1/canvases/:canvasId/viewport', async (c) =>
    c.json({
      ok: true,
      viewport: store.recordViewport(c.req.param('canvasId'), await readCoreJson(c, 'viewport'), 'user')
    })
  );
  app.post('/api/v1/canvases/:canvasId/viewport/focus', async (c) =>
    c.json({
      ok: true,
      viewport: store.recordViewport(c.req.param('canvasId'), await readCoreJson(c, 'focus'), 'agent')
    })
  );
  app.post('/api/v1/canvases/:canvasId/snapshot', async (c) => {
    const canvas = store.getCanvas(c.req.param('canvasId'));
    const projection = await resolveCanvasProjection(canvas, registry, true, c.req.raw.signal);
    const items = await collectSnapshotItems({
      canvasId: canvas.id,
      elements: canvas.elements,
      elementRuntime: projection.elementRuntime,
      registry,
      theme: canvas.theme ?? DEFAULT_CANVAS_THEME,
      signal: c.req.raw.signal
    });
    const composed = composeSnapshot({
      items,
      background: canvas.background?.color ?? canvas.theme?.colors.canvas,
      minimumWidth: canvas.bounds.mode === 'fixed' ? canvas.bounds.width : undefined,
      minimumHeight: canvas.bounds.mode === 'fixed' ? canvas.bounds.height : undefined
    });
    const handle = resources.registerBytes(new TextEncoder().encode(composed.svg), {
      mimeType: 'image/svg+xml',
      width: composed.width,
      height: composed.height
    });
    return c.json({ snapshot: handle, diagnostics: [...projection.diagnostics, ...composed.diagnostics] });
  });

  app.get('/api/v1/share/:token', async (c) => {
    const resolved = store.resolveShareToken(c.req.param('token'));
    const projection = await resolveCanvasProjection(resolved.canvas, registry, true, c.req.raw.signal);
    return c.json({ ok: true, ...resolved, ...projection, readOnly: true });
  });
}
