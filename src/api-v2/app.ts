import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import Ajv2020 from 'ajv/dist/2020.js';
import { Hono } from 'hono';
import { matchedRoutes } from 'hono/route';
import {
  type CreateEmbedSessionInput,
  EMBED_SESSION_CREATE_REQUEST_SCHEMA,
  EMBED_SESSION_LIMITS
} from '../embed-sessions.js';
import { CanvasError, toCanvasError } from '../errors.js';
import { MACRO_RUNTIME_LIMITS, MacroError } from '../macros/index.js';
import type { V2Runtime } from '../runtime.js';
import { AGENTCANVAS_HOST_API_VERSION, AGENTCANVAS_VERSION } from '../version.js';
import { resolveCanvasProjection } from './canvas-projection.js';
import { registerCanvasRoutes } from './canvas-routes.js';
import { registerMacroRoutes } from './macro-routes.js';
import { assetsProviderStatus, capabilityStatus, registerPluginRoutes } from './plugin-routes.js';
import { problemFromCanvasError, problemFromMacroError, requestId, sendProblem } from './problem-contract.js';

const INSTALLATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB_BUILD_ROOT = path.join(INSTALLATION_ROOT, 'dist', 'web');
const WEB_SHELL_PATH = path.join(WEB_BUILD_ROOT, 'index.html');

function readWebShell(): string {
  try {
    return fs.readFileSync(WEB_SHELL_PATH, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`AgentCanvas browser build is unavailable at ${WEB_SHELL_PATH}: ${detail}`);
  }
}

export function createV2App(runtime: V2Runtime): Hono {
  const { config, registry, store, embedSessions } = runtime;
  const app = new Hono();
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const embedSessionCreateValidator = ajv.compile(
    EMBED_SESSION_CREATE_REQUEST_SCHEMA as unknown as Record<string, unknown>
  );

  app.onError((error, c) => {
    const correlationId = requestId(c);
    const problem =
      error instanceof MacroError
        ? problemFromMacroError(error, correlationId, c.req.path)
        : problemFromCanvasError(toCanvasError(error), correlationId, c.req.path);
    if (problem.status >= 500) {
      // Log source locations, never exception messages or request values: either can contain credentials.
      const frames = (error.stack ?? '')
        .split('\n')
        .slice(1)
        .flatMap((line) => {
          const location = line.match(/([^\\/():\s]+\.[cm]?[jt]s):(\d+):(\d+)\)?$/);
          return location ? [`${location[1]}:${location[2]}:${location[3]}`] : [];
        });
      process.stderr.write(
        `${JSON.stringify({
          service: 'AgentCanvas',
          level: 'error',
          time: new Date().toISOString(),
          requestId: correlationId,
          method: c.req.method,
          route: matchedRoutes(c).at(-1)?.path,
          status: problem.status,
          code: problem.code,
          stage: 'http',
          outcome: 'failed',
          frames
        })}\n`
      );
    }
    return sendProblem(c, problem);
  });
  app.use('/assets/*', serveStatic({ root: WEB_BUILD_ROOT }));

  app.get('/health', async (c) => {
    const statuses = await capabilityStatus(registry);
    const assets = statuses['agentcanvas.assets'];
    return c.json({
      ok: true,
      service: 'AgentCanvas',
      version: AGENTCANVAS_VERSION,
      dependencies: { ...(assets ? { assets } : {}) }
    });
  });
  app.get('/whoami', async (c) => {
    const assets = await assetsProviderStatus(registry, c.req.raw.signal);
    return c.json({
      service: 'AgentCanvas',
      version: AGENTCANVAS_VERSION,
      pluginApi: AGENTCANVAS_HOST_API_VERSION,
      plugins: registry.plugins.map((plugin) => plugin.plugin.manifest.id),
      dependencies: { ...(assets ? { assets } : {}) },
      macros: MACRO_RUNTIME_LIMITS,
      embedding: {
        maxCanvasIds: EMBED_SESSION_LIMITS.maxCanvasIds,
        minTtlSeconds: EMBED_SESSION_LIMITS.minTtlSeconds,
        maxTtlSeconds: EMBED_SESSION_LIMITS.maxTtlSeconds,
        storage: 'process-memory'
      },
      mcp: { endpoint: `${config.publicBaseUrl}/mcp`, transport: 'streamable-http' },
      host: config.host,
      port: config.port
    });
  });
  app.get('/openapi.json', (c) => c.json(runtime.openapi));
  if (runtime.developmentReloadVersion) {
    app.get('/__agentcanvas/dev-version', (c) => {
      c.header('cache-control', 'no-store');
      return c.text(runtime.developmentReloadVersion ?? '');
    });
    app.get('/__agentcanvas/dev-reload.js', (c) => {
      c.header('content-type', 'text/javascript; charset=utf-8');
      c.header('cache-control', 'no-store');
      return c.body(`
const initial = await fetch('/__agentcanvas/dev-version', { cache: 'no-store' }).then((response) => response.text());
setInterval(async () => {
  try {
    const current = await fetch('/__agentcanvas/dev-version', { cache: 'no-store' }).then((response) => response.text());
    if (current && current !== initial) location.reload();
  } catch (error) {
    void error;
  }
}, 750);
`);
    });
  }

  registerPluginRoutes(app, runtime);
  app.post('/api/v1/embed-sessions', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new CanvasError('validation_error', 'embed session request must be valid JSON', 'validation', 400);
    }
    if (!embedSessionCreateValidator(input)) {
      throw new CanvasError(
        'validation_error',
        'embed session request does not match the canonical schema',
        'validation',
        400
      );
    }
    const created = embedSessions.create(input as CreateEmbedSessionInput, (canvasId) => {
      store.getCanvas(canvasId);
    });
    return c.json({ ok: true, ...created }, 201);
  });
  app.get('/api/v1/embed-sessions/:token', async (c) => {
    const selected = embedSessions.select(c.req.param('token'), c.req.query('canvasId'));
    const canvas = store.getCanvas(selected.canvasId);
    const readOnly = selected.session.mode === 'read';
    const projection = await resolveCanvasProjection(
      canvas,
      registry,
      readOnly,
      c.req.raw.signal,
      store.getConfiguration().diagnostics
    );
    return c.json({ ok: true, session: selected.session, canvas, ...projection, readOnly });
  });
  app.delete('/api/v1/embed-sessions/:token', (c) =>
    c.json({ ok: true, session: embedSessions.revoke(c.req.param('token')) })
  );
  registerMacroRoutes(app, runtime);
  registerCanvasRoutes(app, runtime);
  const webShell = () => {
    const shell = readWebShell();
    return runtime.developmentReloadVersion
      ? shell.replace('</body>', '<script type="module" src="/__agentcanvas/dev-reload.js"></script></body>')
      : shell;
  };
  app.get('/', (c) => c.html(webShell()));
  app.get('/canvases', (c) => c.html(webShell()));
  app.get('/canvases/:canvasId', (c) => c.html(webShell()));
  app.get('/c/:shareToken', (c) => c.html(webShell()));
  app.get('/embed/:token', (c) => {
    embedSessions.get(c.req.param('token'));
    return c.html(webShell());
  });
  return app;
}
