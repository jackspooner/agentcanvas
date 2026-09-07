import type { JsonObject } from '@agentcanvas/plugin-sdk';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Context, Hono } from 'hono';
import {
  MACRO_ARCHIVE_RESPONSE_SCHEMA,
  MACRO_CREATE_REQUEST_SCHEMA,
  MACRO_CREATE_RESPONSE_SCHEMA,
  MACRO_CREATE_VERSION_RESPONSE_SCHEMA,
  MACRO_EXECUTE_RESPONSE_SCHEMA,
  MACRO_GET_REQUEST_SCHEMA,
  MACRO_GET_RESPONSE_SCHEMA,
  MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA,
  MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA,
  MACRO_HTTP_EXECUTE_REQUEST_SCHEMA,
  MACRO_HTTP_PLAN_REQUEST_SCHEMA,
  MACRO_LIST_REQUEST_SCHEMA,
  MACRO_LIST_RESPONSE_SCHEMA,
  MACRO_PLAN_RESPONSE_SCHEMA,
  MacroError
} from '../macros/index.js';
import type { V2Runtime } from '../runtime.js';

async function readMacroJson(c: Context, validator: ValidateFunction, label: string): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new MacroError('macro_definition_invalid', `${label} must be valid JSON`, 'definition');
  }
  if (!validator(value))
    throw new MacroError(
      'macro_definition_invalid',
      `${label} does not match the canonical macro schema`,
      'definition'
    );
  return value as JsonObject;
}

function validateMacroResult(value: unknown, validator: ValidateFunction): void {
  if (!validator(value))
    throw new MacroError(
      'macro_execution_invalid',
      'macro service returned data outside the canonical response schema',
      'execution',
      { status: 500 }
    );
}

export function registerMacroRoutes(app: Hono, runtime: V2Runtime): void {
  const { macros } = runtime;
  const ajv = new Ajv2020({ strict: true, allErrors: true, useDefaults: false });
  const macroValidators = new Map<string, ValidateFunction>([
    ['list', ajv.compile(MACRO_LIST_REQUEST_SCHEMA)],
    ['create', ajv.compile(MACRO_CREATE_REQUEST_SCHEMA)],
    ['get', ajv.compile(MACRO_GET_REQUEST_SCHEMA)],
    ['createVersionHttp', ajv.compile(MACRO_HTTP_CREATE_VERSION_REQUEST_SCHEMA)],
    ['archive', ajv.compile(MACRO_HTTP_ARCHIVE_REQUEST_SCHEMA)],
    ['planHttp', ajv.compile(MACRO_HTTP_PLAN_REQUEST_SCHEMA)],
    ['executeHttp', ajv.compile(MACRO_HTTP_EXECUTE_REQUEST_SCHEMA)]
  ]);
  const macroResponseValidators = new Map<string, ValidateFunction>([
    ['list', ajv.compile(MACRO_LIST_RESPONSE_SCHEMA)],
    ['create', ajv.compile(MACRO_CREATE_RESPONSE_SCHEMA)],
    ['get', ajv.compile(MACRO_GET_RESPONSE_SCHEMA)],
    ['createVersion', ajv.compile(MACRO_CREATE_VERSION_RESPONSE_SCHEMA)],
    ['archive', ajv.compile(MACRO_ARCHIVE_RESPONSE_SCHEMA)],
    ['plan', ajv.compile(MACRO_PLAN_RESPONSE_SCHEMA)],
    ['execute', ajv.compile(MACRO_EXECUTE_RESPONSE_SCHEMA)]
  ]);
  app.get('/api/v1/macros', (c) => {
    const raw = {
      ...(c.req.query('canvasId') !== undefined ? { canvasId: c.req.query('canvasId') } : {}),
      ...(c.req.query('includeArchived') !== undefined
        ? { includeArchived: c.req.query('includeArchived') === 'true' }
        : {}),
      ...(c.req.query('limit') !== undefined ? { limit: Number(c.req.query('limit')) } : {}),
      ...(c.req.query('cursor') !== undefined ? { cursor: c.req.query('cursor') } : {})
    };
    const validator = macroValidators.get('list') as ValidateFunction;
    if (!validator(raw)) throw new MacroError('macro_definition_invalid', 'macro list query is invalid', 'definition');
    const result = macros.list(raw);
    validateMacroResult(result, macroResponseValidators.get('list') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/macros', async (c) => {
    const body = await readMacroJson(c, macroValidators.get('create') as ValidateFunction, 'macro create request');
    const result = macros.create(body as never);
    validateMacroResult(result, macroResponseValidators.get('create') as ValidateFunction);
    return c.json(result, 201);
  });
  app.get('/api/v1/macros/:macroId/versions/:version', (c) => {
    const macroId = c.req.param('macroId') ?? '';
    const macroVersion = Number(c.req.param('version'));
    const request = {
      macroId,
      macroVersion,
      ...(c.req.query('canvasId') !== undefined ? { canvasId: c.req.query('canvasId') } : {})
    };
    if (!(macroValidators.get('get') as ValidateFunction)(request))
      throw new MacroError('macro_definition_invalid', 'macro get path is invalid', 'definition');
    const result = macros.get(request.macroId, request.macroVersion, request.canvasId ?? '');
    validateMacroResult(result, macroResponseValidators.get('get') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/macros/:macroId/versions', async (c) => {
    const macroId = c.req.param('macroId') ?? '';
    const body = await readMacroJson(
      c,
      macroValidators.get('createVersionHttp') as ValidateFunction,
      'macro version request'
    );
    const result = macros.createVersion({ ...body, macroId } as never);
    validateMacroResult(result, macroResponseValidators.get('createVersion') as ValidateFunction);
    return c.json(result, 201);
  });
  app.patch('/api/v1/macros/:macroId', async (c) => {
    const macroId = c.req.param('macroId');
    const body = await readMacroJson(c, macroValidators.get('archive') as ValidateFunction, 'macro archive request');
    const result = macros.archive(macroId, body.archived as boolean);
    validateMacroResult(result, macroResponseValidators.get('archive') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/canvases/:canvasId/macros/*', async (c) => {
    const match = c.req.path.match(/^\/api\/v1\/canvases\/([^/]+)\/macros\/([^/]+):plan$/);
    if (!match) throw new MacroError('macro_definition_invalid', 'macro plan route is invalid', 'definition');
    const canvasId = decodeURIComponent(match[1]);
    const macroId = decodeURIComponent(match[2]);
    const body = await readMacroJson(c, macroValidators.get('planHttp') as ValidateFunction, 'macro plan request');
    const result = macros.plan({ ...body, canvasId, macroId } as never);
    validateMacroResult(result, macroResponseValidators.get('plan') as ValidateFunction);
    return c.json(result);
  });
  app.post('/api/v1/canvases/:canvasId/macros:execute', async (c) => {
    const canvasId = c.req.param('canvasId');
    const body = await readMacroJson(
      c,
      macroValidators.get('executeHttp') as ValidateFunction,
      'macro execute request'
    );
    const result = await macros.execute({ ...body, canvasId } as never);
    validateMacroResult(result, macroResponseValidators.get('execute') as ValidateFunction);
    return c.json(result);
  });
}
