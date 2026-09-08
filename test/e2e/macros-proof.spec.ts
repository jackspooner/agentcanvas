import { readFileSync } from 'node:fs';
import { type APIRequestContext, expect, test } from '@playwright/test';

type JsonRecord = Record<string, unknown>;

interface CanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: JsonRecord;
}

interface CanvasRecord {
  id: string;
  revision: number;
  elements: CanvasElement[];
  url?: string;
}

interface CanvasReadResponse {
  canvas: CanvasRecord;
}

interface CanvasCreateResponse extends CanvasReadResponse {
  url: string;
}

interface MacroPlan {
  planId: string;
  macroId: string;
  macroVersion: number;
  canvasRevision: number;
  previewElements: CanvasElement[];
  outputs: Record<string, string>;
  effectSummary: JsonRecord;
}

interface MacroExecutionResult {
  canvas: CanvasRecord;
  provenance: JsonRecord;
  outputs: Record<string, string>;
  history: JsonRecord;
}

interface MacroRecord {
  definition: JsonRecord & { id: string; version: number };
  currentVersion: number;
  archived: boolean;
}

interface McpTool extends JsonRecord {
  name: string;
}

interface ComparisonTableMacroExample extends JsonRecord {
  elements: Array<{ data: { columns: unknown } }>;
}

const comparisonTableExample = JSON.parse(
  readFileSync(new URL('../../docs/examples/standard-comparison-table.macro.json', import.meta.url), 'utf8')
) as ComparisonTableMacroExample;

function publicUrl(path: string): string {
  return path;
}

async function jsonResponse<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}

async function getCanvas(request: APIRequestContext, canvasId: string): Promise<CanvasRecord> {
  const response = await jsonResponse<CanvasReadResponse>(
    await request.get(publicUrl(`/api/v1/canvases/${encodeURIComponent(canvasId)}`))
  );
  return response.canvas;
}

async function postJson<T>(request: APIRequestContext, path: string, body: JsonRecord): Promise<T> {
  return jsonResponse<T>(
    await request.post(publicUrl(path), {
      headers: { 'content-type': 'application/json' },
      data: body
    })
  );
}

function toolPayload(value: JsonRecord): JsonRecord {
  if (value.isError === true) throw new Error(`MCP tool call failed: ${JSON.stringify(value)}`);
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent as JsonRecord;
  }
  const text = (value.content as Array<JsonRecord> | undefined)?.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error('MCP tool result did not contain structured content');
  return JSON.parse(text) as JsonRecord;
}

class ResidentMcpClient {
  private requestId = 0;
  private sessionId: string | undefined;

  constructor(private readonly request: APIRequestContext) {}

  private async rpc<T extends JsonRecord>(method: string, params: JsonRecord = {}): Promise<T> {
    const response = await this.request.post(publicUrl('/mcp'), {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {})
      },
      data: { jsonrpc: '2.0', id: ++this.requestId, method, params }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = await response.text();
    const json = body.startsWith('{') ? body : body.match(/data:\s*(\{[\s\S]*\})\s*$/m)?.[1];
    if (!json) throw new Error(`MCP response was not JSON: ${body.slice(0, 200)}`);
    const envelope = JSON.parse(json) as { error?: JsonRecord; result?: T };
    if (envelope.error) throw new Error(`MCP JSON-RPC error: ${JSON.stringify(envelope.error)}`);
    if (!envelope.result) throw new Error('MCP JSON-RPC response did not contain a result');
    return envelope.result;
  }

  async initialize(): Promise<void> {
    const response = await this.request.post(publicUrl('/mcp'), {
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      data: {
        jsonrpc: '2.0',
        id: ++this.requestId,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'agentcanvas-macro-proof', version: '1.0.0' }
        }
      }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    this.sessionId = response.headers()['mcp-session-id'];
    const body = await response.text();
    const json = body.startsWith('{') ? body : body.match(/data:\s*(\{[\s\S]*\})\s*$/m)?.[1];
    if (!json) throw new Error('MCP initialize response was not JSON');
    const envelope = JSON.parse(json) as { error?: JsonRecord };
    if (envelope.error) throw new Error(`MCP initialize failed: ${JSON.stringify(envelope.error)}`);
    const initialized = await this.request.post(publicUrl('/mcp'), {
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {})
      },
      data: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }
    });
    expect(initialized.ok(), await initialized.text()).toBeTruthy();
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc<{ tools: McpTool[] }>('tools/list');
    return result.tools;
  }

  async callTool(name: string, argumentsValue: JsonRecord): Promise<JsonRecord> {
    const result = await this.rpc<JsonRecord>('tools/call', { name, arguments: argumentsValue });
    return toolPayload(result);
  }
}

function tableElements(canvas: CanvasRecord): CanvasElement[] {
  return canvas.elements.filter((element) => element.type === 'agentcanvas.table/table');
}

function layoutOf(element: CanvasElement): Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'> {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

async function expectCanvasElementCount(
  request: APIRequestContext,
  canvasId: string,
  count: number
): Promise<CanvasRecord> {
  let canvas = await getCanvas(request, canvasId);
  await expect
    .poll(async () => {
      canvas = await getCanvas(request, canvasId);
      return tableElements(canvas).length;
    })
    .toBe(count);
  return canvas;
}

test('proves the standard comparison-table macro through public HTTP, MCP, and browser surfaces', async ({
  page,
  request
}, testInfo) => {
  const mcp = new ResidentMcpClient(request);
  await mcp.initialize();
  const toolsBeforeSave = await mcp.listTools();
  const toolNames = toolsBeforeSave.map((tool) => tool.name).sort();
  expect(toolNames.filter((name) => name.startsWith('macro_') || name === 'canvas_run_macro')).toEqual([
    'canvas_run_macro',
    'macro_archive',
    'macro_create',
    'macro_create_version',
    'macro_get',
    'macro_list',
    'macro_plan'
  ]);
  expect(toolNames).toEqual(
    expect.arrayContaining([
      'canvas_get',
      'canvas_inspect',
      'canvas_run_macro',
      'macro_create',
      'macro_create_version',
      'macro_archive',
      'macro_get',
      'macro_list',
      'macro_plan'
    ])
  );

  const createdCanvas = await postJson<CanvasCreateResponse>(request, '/api/v1/canvases', {
    title: `Macro proof canvas ${testInfo.workerIndex}`
  });
  const canvas = { ...createdCanvas.canvas, url: createdCanvas.url };
  const beforePlan = await getCanvas(request, canvas.id);
  expect(beforePlan.revision).toBe(1);
  expect(tableElements(beforePlan)).toHaveLength(0);

  const created = await postJson<MacroRecord>(request, '/api/v1/macros', comparisonTableExample);
  expect(created.definition.version).toBe(1);
  expect(created.currentVersion).toBe(1);
  expect(created.archived).toBe(false);

  const toolsAfterSave = await mcp.listTools();
  expect(toolsAfterSave).toEqual(toolsBeforeSave);

  const exact = (await mcp.callTool('macro_get', {
    macroId: created.definition.id,
    macroVersion: 1
  })) as unknown as MacroRecord;
  expect(exact.definition.id).toBe(created.definition.id);
  expect(exact.definition.version).toBe(1);

  const rowsA = [
    ['Battery', '8 hours', '10 hours', 'Option B'],
    ['Weight', '1.4 kg', '1.7 kg', 'Option A']
  ];
  const planA = await postJson<MacroPlan>(
    request,
    `/api/v1/canvases/${encodeURIComponent(canvas.id)}/macros/${encodeURIComponent(created.definition.id)}:plan`,
    {
      macroVersion: 1,
      anchor: { x: 40, y: 60 },
      input: { rows: rowsA },
      label: 'Standard comparison table'
    }
  );
  expect(planA.macroVersion).toBe(1);
  expect(planA.canvasRevision).toBe(beforePlan.revision);
  expect(planA.previewElements).toHaveLength(1);
  expect(planA.effectSummary).toMatchObject({ operationCount: 1, generatedElementCount: 1 });
  expect(Object.keys(planA.outputs)).toEqual(['table']);
  expect((await getCanvas(request, canvas.id)).revision).toBe(beforePlan.revision);
  expect(tableElements(await getCanvas(request, canvas.id))).toHaveLength(0);

  const mcpPlanB = await mcp.callTool('macro_plan', {
    canvasId: canvas.id,
    macroId: created.definition.id,
    macroVersion: 1,
    anchor: { x: 40, y: 60 },
    input: {
      rows: [['Battery', '7 hours', '11 hours', 'Option B']]
    }
  });
  expect(mcpPlanB.macroVersion).toBe(1);
  expect(Object.keys((mcpPlanB.outputs ?? {}) as JsonRecord)).toEqual(['table']);

  const executedA = await postJson<MacroExecutionResult>(
    request,
    `/api/v1/canvases/${encodeURIComponent(canvas.id)}/macros:execute`,
    {
      planId: planA.planId,
      expectedRevision: beforePlan.revision,
      idempotencyKey: `macro-proof-${testInfo.workerIndex}-a`
    }
  );
  expect(executedA.provenance).toMatchObject({
    macroId: created.definition.id,
    macroVersion: 1,
    planId: planA.planId
  });
  expect(executedA.provenance).not.toHaveProperty('input');
  expect(Object.keys(executedA.outputs)).toEqual(['table']);
  expect(executedA.outputs.table).toBe(planA.outputs.table);

  const retriedA = await postJson<MacroExecutionResult>(
    request,
    `/api/v1/canvases/${encodeURIComponent(canvas.id)}/macros:execute`,
    {
      planId: planA.planId,
      expectedRevision: beforePlan.revision,
      idempotencyKey: `macro-proof-${testInfo.workerIndex}-a`
    }
  );
  expect(retriedA.outputs).toEqual(executedA.outputs);

  const afterA = await getCanvas(request, canvas.id);
  expect(afterA.revision).toBe(beforePlan.revision + 1);
  const tableA = tableElements(afterA);
  expect(tableA).toHaveLength(1);
  expect(tableA[0].data.rows).toEqual(rowsA);

  const rowsB = [['Battery', '7 hours', '11 hours', 'Option B']];
  const browserUrl = canvas.url;
  if (!browserUrl) throw new Error('Canvas creation did not return the public browser URL');
  await page.goto(browserUrl);
  await expect(page.getByRole('button', { name: 'Macros' })).toBeVisible();
  const persistedBeforePreview = await getCanvas(request, canvas.id);
  await page.getByRole('button', { name: 'Macros' }).click();
  const definitionResponse = page.waitForResponse((response) => response.url().includes('/versions/1?canvasId='));
  await page.getByRole('button', { name: /Standard comparison table/ }).click();
  expect((await definitionResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Standard comparison table', level: 3 })).toBeVisible();
  await page.locator('#macro-input-rows').fill(JSON.stringify(rowsB));
  await page.locator('#macro-anchor-x').fill('40');
  await page.locator('#macro-anchor-y').fill('60');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('[data-macro-ghost="true"]')).toBeVisible();
  await expect(page.getByText(`Plan revision ${afterA.revision}; 1 operation ready.`)).toBeVisible();
  expect((await getCanvas(request, canvas.id)).revision).toBe(persistedBeforePreview.revision);
  expect(tableElements(await getCanvas(request, canvas.id))).toHaveLength(1);

  const executeResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/v1/canvases/${encodeURIComponent(canvas.id)}/macros:execute`)
  );
  await page.getByRole('button', { name: 'Run macro' }).click();
  const executedB = (await (await executeResponse).json()) as MacroExecutionResult;
  expect(executedB.provenance).toMatchObject({ macroId: created.definition.id, macroVersion: 1 });
  expect(executedB.provenance).not.toHaveProperty('input');
  expect(Object.keys(executedB.outputs)).toEqual(['table']);

  const afterB = await expectCanvasElementCount(request, canvas.id, 2);
  expect(afterB.revision).toBe(afterA.revision + 1);
  const tablesB = tableElements(afterB);
  expect(tablesB[0].data).toMatchObject({ columns: comparisonTableExample.elements[0].data.columns, rows: rowsA });
  expect(tablesB[1].data).toMatchObject({ columns: comparisonTableExample.elements[0].data.columns, rows: rowsB });
  expect(layoutOf(tablesB[0])).toEqual(layoutOf(tablesB[1]));
  expect(executedB.outputs.table).toBe(tablesB[1].id);
  await expect(page.getByTestId('macro-ghost-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  const afterUndo = await expectCanvasElementCount(request, canvas.id, 1);
  expect(tableElements(afterUndo)[0].data.rows).toEqual(rowsA);
  await page.getByRole('button', { name: 'Redo' }).click();
  const afterRedo = await expectCanvasElementCount(request, canvas.id, 2);
  expect(tableElements(afterRedo)[1].data.rows).toEqual(rowsB);

  const inspectedCanvas = await mcp.callTool('canvas_get', { canvasId: canvas.id });
  expect(inspectedCanvas.id).toBe(canvas.id);
  const inspection = await mcp.callTool('canvas_inspect', { canvasId: canvas.id });
  expect(inspection).toHaveProperty('canvasId', canvas.id);
});

test('saves diagnostics from the canvas index and preserves settings across reloads and default-size changes', async ({
  page,
  request
}) => {
  await page.goto('/');
  await page.getByText('Diagnostics', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Overlap warnings', exact: true }).selectOption('bounded');
  await page.getByLabel('Maximum overlap warnings').fill('7');
  await page.getByRole('button', { name: 'Save diagnostics' }).click();
  const configuration = async () => (await (await request.get('/api/v1/configuration')).json()).configuration;
  await expect
    .poll(async () => (await configuration()).diagnostics)
    .toEqual({ overlapMode: 'bounded', maxOverlapWarnings: 7 });
  await page.reload();
  await page.getByText('Diagnostics', { exact: true }).click();
  await expect(page.getByLabel('Maximum overlap warnings')).toHaveValue('7');
  await page.getByLabel('Maximum overlap warnings').fill('');
  await page.getByRole('combobox', { name: 'Overlap warnings', exact: true }).selectOption('all');
  await expect(page.getByText('All checks every pair', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Save diagnostics' }).click();
  await expect.poll(async () => (await configuration()).diagnostics.overlapMode).toBe('all');
  const response = await request.patch('/api/v1/configuration', {
    data: { defaultCanvasSize: { mode: 'fixed', width: 800, height: 600 } }
  });
  expect(response.ok()).toBe(true);
  expect((await configuration()).diagnostics).toEqual({ overlapMode: 'all', maxOverlapWarnings: 7 });
  await page.getByRole('combobox', { name: 'Overlap warnings', exact: true }).selectOption('off');
  await page.getByRole('button', { name: 'Save diagnostics' }).click();
  await expect.poll(async () => (await configuration()).diagnostics.overlapMode).toBe('off');
  await page.reload();
  await page.getByText('Diagnostics', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Overlap warnings', exact: true })).toHaveValue('off');
  await request.patch('/api/v1/configuration', {
    data: { diagnostics: { overlapMode: 'bounded', maxOverlapWarnings: 100 }, defaultCanvasSize: { mode: 'unlimited' } }
  });
});
