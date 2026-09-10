import fs from 'node:fs';
import type { AssetsCapabilityV1, JsonObject, PluginInvocationContext } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Context, Hono } from 'hono';
import { nanoid } from 'nanoid';
import { CanvasError } from '../errors.js';
import {
  createPluginCanvasOperations,
  type FrozenPluginRegistry,
  resolveBrowserPluginModule
} from '../plugin-runtime/index.js';
import type { V2Runtime } from '../runtime.js';
import type { V2SqliteCanvasStore } from '../store/v2.js';
import { createPluginStatusCatalog, createProcedureCatalog, getPluginStatus } from './index.js';
import { problemForCode, requestId, sendProblem } from './problem-contract.js';

function invocationContext(
  store: V2SqliteCanvasStore,
  registry: FrozenPluginRegistry,
  pluginId: string,
  signal: AbortSignal
): PluginInvocationContext {
  const plugin = registry.getPlugin(pluginId);
  if (!plugin) throw new CanvasError('plugin_unavailable', `plugin is not active: ${pluginId}`, 'not_found', 404);
  return {
    signal,
    correlationId: `call_${nanoid(16)}`,
    canvas: createPluginCanvasOperations(store, pluginId, plugin.plugin.manifest.permissions, registry)
  };
}

export async function capabilityStatus(
  registry: FrozenPluginRegistry
): Promise<Record<string, { ok: boolean; code?: string; retryable?: boolean }>> {
  const result: Record<string, { ok: boolean; code?: string; retryable?: boolean }> = {};
  for (const [name, provider] of Object.entries(registry.capabilities)) {
    const readiness = await provider.readiness?.();
    result[name] = readiness
      ? {
          ok: readiness.ok,
          ...(readiness.code ? { code: readiness.code } : {}),
          ...(readiness.retryable !== undefined ? { retryable: readiness.retryable } : {})
        }
      : { ok: true };
  }
  return result;
}

export async function assetsProviderStatus(
  registry: FrozenPluginRegistry,
  signal?: AbortSignal
): Promise<{
  ok: boolean;
  identity?: string;
  capabilities?: readonly string[];
  code?: string;
  retryable?: boolean;
} | null> {
  const provider = registry.capabilities['agentcanvas.assets'];
  if (!provider) return null;
  const value = provider.value as AssetsCapabilityV1;
  if (typeof value.providerStatus !== 'function') {
    return { ok: false, code: 'assets_provider_status_missing', retryable: false };
  }
  try {
    return await value.providerStatus(signal);
  } catch {
    return { ok: false, code: 'assets_unavailable', retryable: true };
  }
}

export function registerPluginRoutes(app: Hono, runtime: V2Runtime): void {
  const { registry, browserCatalog, resources, store } = runtime;
  const procedures = createProcedureCatalog(registry);
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const procedureValidators = new Map<string, { input: ValidateFunction; output: ValidateFunction }>(
    procedures.procedures.map((procedure) => [
      `${procedure.pluginId}\0${procedure.name}`,
      { input: ajv.compile(procedure.descriptor.inputSchema), output: ajv.compile(procedure.descriptor.outputSchema) }
    ])
  );
  app.get('/api/v1/plugins', async (c) =>
    c.json(
      createPluginStatusCatalog(registry, {
        browserEntries: browserCatalog.entries,
        diagnostics: runtime.plugins.diagnostics.list(),
        capabilityStatus: await capabilityStatus(registry)
      })
    )
  );
  app.get('/api/v1/plugins/:pluginId', async (c) => {
    const status = getPluginStatus(
      createPluginStatusCatalog(registry, {
        browserEntries: browserCatalog.entries,
        diagnostics: runtime.plugins.diagnostics.list(),
        capabilityStatus: await capabilityStatus(registry)
      }),
      c.req.param('pluginId')
    );
    return status
      ? c.json(status)
      : sendProblem(c, problemForCode('plugin_unavailable', 'Plugin is not active.', requestId(c), c.req.path));
  });
  app.get('/api/v1/plugin-modules/:pluginId/:buildHash/*', async (c) => {
    const module = await resolveBrowserPluginModule(
      browserCatalog,
      c.req.param('pluginId'),
      c.req.param('buildHash'),
      c.req.path.split(`/${c.req.param('buildHash')}/`)[1] ?? ''
    );
    return new Response(fs.readFileSync(module.filePath), {
      headers: {
        'content-type': module.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin'
      }
    });
  });

  const procedureRoute: string = '/api/v1/plugins/:pluginId/procedures/:procedureName';
  const registerProcedureRoute = app.post as unknown as (
    route: string,
    handler: (context: Context) => Response | Promise<Response>
  ) => void;
  registerProcedureRoute(procedureRoute, async (c: Context): Promise<Response> => {
    const match = c.req.path.match(/^\/api\/v1\/plugins\/([^/]+)\/procedures\/([^/]+)$/);
    if (!match)
      return sendProblem(
        c,
        problemForCode('procedure_not_found', 'Plugin procedure is unavailable.', requestId(c), c.req.path)
      );
    const pluginId = decodeURIComponent(match[1]);
    const procedureName = decodeURIComponent(match[2]);
    const contract = procedures.get(pluginId, procedureName);
    if (!contract)
      return sendProblem(
        c,
        problemForCode('procedure_not_found', 'Plugin procedure is unavailable.', requestId(c), c.req.path)
      );
    const input = await c.req.json();
    const validators = procedureValidators.get(`${pluginId}\0${procedureName}`) as {
      input: ValidateFunction;
      output: ValidateFunction;
    };
    if (!validators.input(input))
      return sendProblem(
        c,
        problemForCode('validation_error', 'Procedure input is invalid.', requestId(c), c.req.path)
      );
    const timeoutSignal = AbortSignal.timeout(30_000);
    const signal = AbortSignal.any([c.req.raw.signal, timeoutSignal]);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutSignal.addEventListener(
        'abort',
        () =>
          reject(new CanvasError('procedure_timeout', 'plugin procedure exceeded 30 seconds', 'rendering', 504, true)),
        { once: true }
      );
    });
    const output = await Promise.race([
      contract.descriptor.invoke(input as JsonObject, invocationContext(store, registry, pluginId, signal)),
      timeout
    ]);
    if (!validators.output(output)) throw new Error('plugin procedure returned data outside its declared schema');
    return c.json(output);
  });

  app.get('/api/v1/resources/:handle/details', (c) => {
    const details = resources.details(c.req.param('handle'));
    return details
      ? c.json(details)
      : sendProblem(c, problemForCode('resource_not_found', 'Resource handle not found.', requestId(c), c.req.path));
  });
  app.get('/api/v1/resources/:handle/content', async (c) => {
    const payload = await resources.load(c.req.param('handle'), c.req.raw.signal);
    return payload
      ? new Response(payload.bytes.slice().buffer as ArrayBuffer, {
          headers: {
            'content-type': payload.mimeType,
            'content-length': String(payload.bytes.byteLength),
            'cache-control': 'private, max-age=300',
            'x-content-type-options': 'nosniff',
            'cross-origin-resource-policy': 'same-origin'
          }
        })
      : sendProblem(c, problemForCode('resource_not_found', 'Resource handle not found.', requestId(c), c.req.path));
  });
}
