import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMcpV2Server } from '../src/mcp-v2/server.js';
import { preparePluginRuntime } from '../src/plugin-runtime/index.js';
import { createV2App, createV2Runtime } from '../src/server-v2.js';

const roots: string[] = [];
const token = 'agentcanvas-test-token';

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function copyPlugin(pluginsRoot: string, sourceName: string, pluginId: string): string {
  const source = path.resolve('plugin-packages', sourceName);
  const destination = path.join(pluginsRoot, pluginId);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['agentcanvas.plugin.json', 'LICENSE', 'README.md']) {
    fs.copyFileSync(path.join(source, name), path.join(destination, name));
  }
  fs.cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
  if (fs.existsSync(path.join(source, 'src'))) {
    fs.cpSync(path.join(source, 'src'), path.join(destination, 'src'), { recursive: true });
  }
  if (fs.existsSync(path.join(source, 'schemas'))) {
    fs.cpSync(path.join(source, 'schemas'), path.join(destination, 'schemas'), { recursive: true });
  }
  return destination;
}

function fixtureRoot(): { root: string; pluginsRoot: string; outputRoot: string; outsideRoot: string } {
  const temporaryParent = path.resolve('tmp');
  fs.mkdirSync(temporaryParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryParent, 'agentcanvas-mediatools-runtime-'));
  roots.push(root);
  const pluginsRoot = path.join(root, 'plugins');
  const outputRoot = path.join(root, 'output');
  const outsideRoot = path.join(root, 'outside');
  fs.mkdirSync(pluginsRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  copyPlugin(pluginsRoot, 'gallery', 'agentcanvas.gallery');
  const filesystemPlugin = copyPlugin(pluginsRoot, 'filesystem-images', 'agentcanvas.filesystem-images');
  const mediatoolsPlugin = copyPlugin(pluginsRoot, 'mediatools', 'agentcanvas.mediatools');
  fs.writeFileSync(
    path.join(filesystemPlugin, 'plugin.config.json'),
    JSON.stringify({ roots: [{ id: 'workspace2', path: outputRoot }], contentMaxBytes: 1024, resourceTtlMs: 60_000 })
  );
  fs.writeFileSync(
    path.join(mediatoolsPlugin, 'plugin.config.json'),
    JSON.stringify({ baseUrl: 'http://127.0.0.1:1', outputDirectory: outputRoot, filesystemRootId: 'workspace2' })
  );
  fs.writeFileSync(path.join(outputRoot, 'first.png'), Buffer.from('first image'));
  fs.writeFileSync(path.join(outputRoot, 'second.png'), Buffer.from('second image'));
  return { root, pluginsRoot, outputRoot, outsideRoot };
}

type Job = { status: 'queued' | 'running' | 'completed' | 'failed'; file?: string };

async function startMediaTools(
  jobs: Map<string, Job>
): Promise<{ baseUrl: string; requestCount(): number; close(): Promise<void> }> {
  let requestCount = 0;
  const server = http.createServer(async (request, response) => {
    requestCount += 1;
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { Allow: 'POST, OPTIONS' });
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const mcp = new McpServer({ name: 'agentcanvas-runtime-test', version: '1.0.0' });
    mcp.registerTool('image_job', { inputSchema: { runId: z.string() } }, async ({ runId }) => {
      const job = jobs.get(runId as string) ?? { status: 'failed' as const };
      const files =
        job.status === 'completed' && job.file
          ? [
              {
                type: 'file',
                path: job.file,
                sha256: crypto.createHash('sha256').update(fs.readFileSync(job.file)).digest('hex'),
                byteSize: fs.statSync(job.file).size,
                mimeType: 'image/png'
              }
            ]
          : [];
      const result = { mediaType: 'image', status: job.status, runId, files };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    } finally {
      await transport.close().catch(() => {});
      await mcp.close().catch(() => {});
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requestCount: () => requestCount,
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  };
}

async function createCanvas(app: ReturnType<typeof createV2App>): Promise<string> {
  const response = await app.request('/api/v1/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'MediaTools binding' })
  });
  expect(response.status).toBe(201);
  return (await response.json()).canvas.id as string;
}

async function addGallery(app: ReturnType<typeof createV2App>, canvasId: string): Promise<void> {
  const response = await app.request(`/api/v1/canvases/${canvasId}/elements:batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operations: [
        {
          op: 'upsertElement',
          element: {
            id: 'gallery',
            type: 'agentcanvas.gallery/gallery',
            schemaVersion: 1,
            x: 24,
            y: 36,
            width: 520,
            height: 350,
            zIndex: 7,
            rotation: 3,
            data: {
              items: [
                {
                  id: 'first',
                  source: {
                    provider: 'agentcanvas.filesystem-images',
                    reference: { rootId: 'workspace2', path: 'first.png' }
                  },
                  caption: 'First',
                  alt: 'First image'
                },
                {
                  id: 'second',
                  source: {
                    provider: 'agentcanvas.filesystem-images',
                    reference: { rootId: 'workspace2', path: 'second.png' }
                  },
                  caption: 'Selected',
                  alt: 'Second image'
                }
              ],
              presentation: 'carousel',
              fit: 'cover',
              initialIndex: 1,
              autoplay: false,
              intervalMs: 8000,
              showControls: false,
              showIndicators: true
            }
          }
        }
      ]
    })
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

function mcpClient(runtime: Awaited<ReturnType<typeof createV2Runtime>>) {
  const server = createMcpV2Server(
    {
      publicBaseUrl: runtime.config.publicBaseUrl,
      registry: runtime.registry,
      store: runtime.store,
      browserCatalog: runtime.browserCatalog,
      viewerPresence: runtime.viewerPresence,
      diagnostics: () => runtime.plugins.diagnostics.list()
    },
    'full'
  );
  const client = new Client({ name: 'agentcanvas-mediatools-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  return {
    server,
    client,
    async connect() {
      await Promise.all([server.server.connect(serverTransport), client.connect(clientTransport)]);
    }
  };
}

describe('MediaTools binding runtime boundaries', () => {
  it('prepares extension tools offline without a token or a worker request', async () => {
    const fixture = fixtureRoot();
    let requests = 0;
    const media = await startMediaTools(new Map());
    const originalToken = process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    const pluginConfig = path.join(fixture.pluginsRoot, 'agentcanvas.mediatools', 'plugin.config.json');
    fs.writeFileSync(
      pluginConfig,
      JSON.stringify({ baseUrl: media.baseUrl, outputDirectory: fixture.outputRoot, filesystemRootId: 'workspace2' })
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      requests += 1;
      return originalFetch(...args);
    };
    try {
      const prepared = await preparePluginRuntime(fixture.pluginsRoot);
      expect(prepared.registry.getPlugin('agentcanvas.mediatools')?.tools.map((tool) => tool.name)).toEqual([
        'bind',
        'get-binding',
        'list-bindings'
      ]);
      expect(requests).toBe(0);
      prepared.resources.dispose();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
      else process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = originalToken;
      await media.close();
    }
  });

  it('projects pending, running, and completed states through MCP, HTTP, snapshots, and canonical Gallery data', async () => {
    const fixture = fixtureRoot();
    const jobs = new Map<string, Job>([['job-1', { status: 'queued' }]]);
    const media = await startMediaTools(jobs);
    const configFile = path.join(fixture.pluginsRoot, 'agentcanvas.mediatools', 'plugin.config.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ baseUrl: media.baseUrl, outputDirectory: fixture.outputRoot, filesystemRootId: 'workspace2' })
    );
    const originalToken = process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = token;
    const runtime = await createV2Runtime({ pluginsRoot: fixture.pluginsRoot, databasePath: ':memory:' });
    const app = createV2App(runtime);
    const canvasId = await createCanvas(app);
    await addGallery(app, canvasId);
    const api = mcpClient(runtime);
    try {
      await api.connect();
      const input = {
        bindingId: 'generated-1',
        canvasId,
        runId: 'job-1',
        target: { kind: 'append', elementId: 'gallery', itemId: 'generated-1' },
        caption: 'Generated caption',
        alt: 'Generated image'
      };
      const bound = await api.client.callTool({ name: 'agentcanvas_mediatools__bind', arguments: input });
      expect(bound.structuredContent).toMatchObject({
        binding: { bindingId: 'generated-1', status: 'queued' },
        receipt: {
          canvasId,
          revision: 3,
          inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
        }
      });
      expect((bound.structuredContent as { receipt: Record<string, unknown> }).receipt).not.toHaveProperty('elementId');
      const duplicate = await api.client.callTool({ name: 'agentcanvas_mediatools__bind', arguments: input });
      expect(duplicate.structuredContent).toMatchObject({ binding: { bindingId: 'generated-1', status: 'queued' } });
      const conflict = await api.client.callTool({
        name: 'agentcanvas_mediatools__bind',
        arguments: { ...input, caption: 'different' }
      });
      expect(conflict.isError).toBe(true);
      expect(conflict.structuredContent).toMatchObject({ problem: { code: 'idempotency_conflict', status: 409 } });

      const getCanvas = async () => await (await app.request(`/api/v1/canvases/${canvasId}`)).json();
      let projection = await getCanvas();
      expect(
        projection.elementRuntime.gallery.items.find((item: { id: string }) => item.id === 'generated-1')
      ).toMatchObject({
        id: 'generated-1',
        state: 'queued',
        message: 'Waiting for image…'
      });
      const selectCover = (itemId: string) =>
        api.client.callTool({
          name: 'agentcanvas_gallery__set_cover',
          arguments: { canvasId, elementId: 'gallery', itemId }
        });
      await selectCover('generated-1');
      let snapshot = await (await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' })).json();
      expect(await (await app.request(snapshot.snapshot.url)).text()).toContain('Waiting for image…');
      await selectCover('second');

      jobs.set('job-1', { status: 'running' });
      await vi.waitFor(
        async () => {
          const status = await api.client.callTool({
            name: 'agentcanvas_mediatools__get_binding',
            arguments: { bindingId: 'generated-1' }
          });
          expect(status.structuredContent).toMatchObject({ binding: { status: 'running' } });
          projection = await getCanvas();
          const row = projection.elementRuntime.gallery.items.find((item: { id: string }) => item.id === 'generated-1');
          expect(row).toMatchObject({ state: 'running', message: 'Generating image…' });
        },
        { timeout: 7500, interval: 100 }
      );
      await selectCover('generated-1');
      snapshot = await (await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' })).json();
      expect(await (await app.request(snapshot.snapshot.url)).text()).toContain('Generating image…');
      await selectCover('second');

      const outputFile = path.join(fixture.outputRoot, 'generated.png');
      fs.writeFileSync(outputFile, Buffer.from('completed image bytes'));
      jobs.set('job-1', { status: 'completed', file: outputFile });
      await vi.waitFor(
        async () => {
          const status = await api.client.callTool({
            name: 'agentcanvas_mediatools__get_binding',
            arguments: { bindingId: 'generated-1' }
          });
          expect(status.structuredContent).toMatchObject({
            binding: {
              status: 'completed',
              source: {
                provider: 'agentcanvas.filesystem-images',
                reference: { rootId: 'workspace2', path: 'generated.png' }
              }
            }
          });
        },
        { timeout: 7500, interval: 100 }
      );

      projection = await getCanvas();
      const gallery = projection.canvas.elements[0];
      expect(gallery).toMatchObject({
        x: 24,
        y: 36,
        width: 520,
        height: 350,
        zIndex: 7,
        rotation: 3,
        data: {
          presentation: 'carousel',
          fit: 'cover',
          initialIndex: 1,
          autoplay: false,
          intervalMs: 8000,
          showControls: false,
          showIndicators: true
        }
      });
      expect(gallery.data.items).toEqual([
        expect.objectContaining({ id: 'first', caption: 'First' }),
        expect.objectContaining({ id: 'second', caption: 'Selected' }),
        expect.objectContaining({
          id: 'generated-1',
          caption: 'Generated caption',
          alt: 'Generated image',
          source: {
            provider: 'agentcanvas.filesystem-images',
            reference: { rootId: 'workspace2', path: 'generated.png' }
          }
        })
      ]);
      expect(JSON.stringify(projection)).not.toContain(fixture.outputRoot);
      snapshot = await (await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' })).json();
      const svg = await (await app.request(snapshot.snapshot.url)).text();
      expect(svg).toContain('2 / 3');
      expect(svg).not.toContain(fixture.outputRoot);
      expect(svg).not.toContain('generated-1');
    } finally {
      await api.client.close();
      await api.server.server.close();
      runtime.dispose();
      await media.close();
      if (originalToken === undefined) delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
      else process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = originalToken;
    }
  }, 25_000);

  it('creates a standalone Gallery image and replaces an existing item on completion', async () => {
    const fixture = fixtureRoot();
    const jobs = new Map<string, Job>([
      ['create-job', { status: 'queued' }],
      ['replace-job', { status: 'queued' }]
    ]);
    const media = await startMediaTools(jobs);
    const configFile = path.join(fixture.pluginsRoot, 'agentcanvas.mediatools', 'plugin.config.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ baseUrl: media.baseUrl, outputDirectory: fixture.outputRoot, filesystemRootId: 'workspace2' })
    );
    const originalToken = process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = token;
    const runtime = await createV2Runtime({ pluginsRoot: fixture.pluginsRoot, databasePath: ':memory:' });
    const app = createV2App(runtime);
    const canvasId = await createCanvas(app);
    await addGallery(app, canvasId);
    const api = mcpClient(runtime);
    try {
      await api.connect();
      const created = await api.client.callTool({
        name: 'agentcanvas_mediatools__bind',
        arguments: {
          bindingId: 'standalone',
          canvasId,
          runId: 'create-job',
          target: { kind: 'image', x: 180, y: 210, width: 360, height: 240 },
          caption: 'Created from job',
          alt: 'Job output'
        }
      });
      expect(created.structuredContent).toMatchObject({ binding: { bindingId: 'standalone', status: 'queued' } });
      const replaced = await api.client.callTool({
        name: 'agentcanvas_mediatools__bind',
        arguments: {
          bindingId: 'replace-source',
          canvasId,
          runId: 'replace-job',
          target: { kind: 'replace', elementId: 'gallery', itemId: 'second' }
        }
      });
      expect(replaced.structuredContent).toMatchObject({ binding: { bindingId: 'replace-source', status: 'queued' } });

      const createdOutput = path.join(fixture.outputRoot, 'created.png');
      const replacedOutput = path.join(fixture.outputRoot, 'replaced.png');
      fs.writeFileSync(createdOutput, Buffer.from('created output'));
      fs.writeFileSync(replacedOutput, Buffer.from('replacement output'));
      jobs.set('create-job', { status: 'completed', file: createdOutput });
      jobs.set('replace-job', { status: 'completed', file: replacedOutput });
      await vi.waitFor(
        async () => {
          const createdStatus = await api.client.callTool({
            name: 'agentcanvas_mediatools__get_binding',
            arguments: { bindingId: 'standalone' }
          });
          const replacedStatus = await api.client.callTool({
            name: 'agentcanvas_mediatools__get_binding',
            arguments: { bindingId: 'replace-source' }
          });
          expect(createdStatus.structuredContent).toMatchObject({ binding: { status: 'completed' } });
          expect(replacedStatus.structuredContent).toMatchObject({ binding: { status: 'completed' } });
        },
        { timeout: 7500, interval: 100 }
      );

      const projection = await (await app.request(`/api/v1/canvases/${canvasId}`)).json();
      expect(projection.canvas.elements).toHaveLength(2);
      const gallery = projection.canvas.elements.find((element: { id: string }) => element.id === 'gallery');
      expect(gallery.data.items).toEqual([
        expect.objectContaining({ id: 'first', caption: 'First' }),
        expect.objectContaining({
          id: 'second',
          caption: 'Selected',
          alt: 'Second image',
          source: {
            provider: 'agentcanvas.filesystem-images',
            reference: { rootId: 'workspace2', path: 'replaced.png' }
          }
        })
      ]);
      expect(gallery).toMatchObject({
        x: 24,
        y: 36,
        width: 520,
        height: 350,
        zIndex: 7,
        rotation: 3,
        data: {
          presentation: 'carousel',
          fit: 'cover',
          initialIndex: 1,
          autoplay: false,
          intervalMs: 8000,
          showControls: false,
          showIndicators: true
        }
      });
      const standalone = projection.canvas.elements.find((element: { id: string }) => element.id === 'standalone');
      expect(standalone).toMatchObject({
        type: 'agentcanvas.gallery/gallery',
        x: 180,
        y: 210,
        width: 360,
        height: 240,
        data: {
          items: [
            {
              id: 'standalone',
              caption: 'Created from job',
              alt: 'Job output',
              source: {
                provider: 'agentcanvas.filesystem-images',
                reference: { rootId: 'workspace2', path: 'created.png' }
              }
            }
          ]
        }
      });
    } finally {
      await api.client.close();
      await api.server.server.close();
      runtime.dispose();
      await media.close();
      if (originalToken === undefined) delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
      else process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = originalToken;
    }
  }, 15_000);

  it('fails startup without a token or valid filesystem root and cancels the empty worker on disposal', async () => {
    const fixture = fixtureRoot();
    const media = await startMediaTools(new Map());
    const configFile = path.join(fixture.pluginsRoot, 'agentcanvas.mediatools', 'plugin.config.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ baseUrl: media.baseUrl, outputDirectory: fixture.outputRoot, filesystemRootId: 'workspace2' })
    );
    const originalToken = process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    try {
      await expect(createV2Runtime({ pluginsRoot: fixture.pluginsRoot, databasePath: ':memory:' })).rejects.toThrow(
        'AGENT_CANVAS_MEDIATOOLS_TOKEN is required'
      );
      expect(media.requestCount()).toBe(0);

      fs.writeFileSync(
        path.join(fixture.pluginsRoot, 'agentcanvas.filesystem-images', 'plugin.config.json'),
        JSON.stringify({
          roots: [{ id: 'workspace2', path: path.join(fixture.root, 'missing-root') }],
          contentMaxBytes: 1024,
          resourceTtlMs: 60_000
        })
      );
      process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = token;
      await expect(createV2Runtime({ pluginsRoot: fixture.pluginsRoot, databasePath: ':memory:' })).rejects.toThrow();
      expect(media.requestCount()).toBe(0);

      fs.writeFileSync(
        path.join(fixture.pluginsRoot, 'agentcanvas.filesystem-images', 'plugin.config.json'),
        JSON.stringify({
          roots: [{ id: 'workspace2', path: fixture.outputRoot }],
          contentMaxBytes: 1024,
          resourceTtlMs: 60_000
        })
      );
      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const runtime = await createV2Runtime({ pluginsRoot: fixture.pluginsRoot, databasePath: ':memory:' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const timerIndex = timeoutSpy.mock.calls.findIndex((call) => call[1] === 5000);
      const workerTimer = timerIndex >= 0 ? timeoutSpy.mock.results[timerIndex]?.value : undefined;
      expect(workerTimer).toBeDefined();
      runtime.dispose();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(workerTimer);
      expect(media.requestCount()).toBe(0);
    } finally {
      vi.restoreAllMocks();
      if (originalToken === undefined) delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
      else process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = originalToken;
      await media.close();
    }
  }, 15_000);

  it('keeps provider failures safe and rejects completed files outside the admitted root', async () => {
    const fixture = fixtureRoot();
    const outsideFile = path.join(fixture.outsideRoot, 'private-output.png');
    fs.writeFileSync(outsideFile, Buffer.from('outside image'));
    const jobs = new Map<string, Job>([
      ['failed-job', { status: 'failed' }],
      ['outside-job', { status: 'completed', file: outsideFile }]
    ]);
    const media = await startMediaTools(jobs);
    const configFile = path.join(fixture.pluginsRoot, 'agentcanvas.mediatools', 'plugin.config.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ baseUrl: media.baseUrl, outputDirectory: fixture.outputRoot, filesystemRootId: 'workspace2' })
    );
    const originalToken = process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
    process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = token;
    const runtime = await createV2Runtime({ pluginsRoot: fixture.pluginsRoot, databasePath: ':memory:' });
    const app = createV2App(runtime);
    const canvasId = await createCanvas(app);
    await addGallery(app, canvasId);
    const api = mcpClient(runtime);
    try {
      await api.connect();
      for (const [bindingId, runId] of [
        ['failed-1', 'failed-job'],
        ['outside-1', 'outside-job']
      ]) {
        const result = await api.client.callTool({
          name: 'agentcanvas_mediatools__bind',
          arguments: {
            bindingId,
            canvasId,
            runId,
            target: { kind: 'append', elementId: 'gallery', itemId: bindingId },
            caption: `Caption ${bindingId}`,
            alt: `Alt ${bindingId}`
          }
        });
        expect(result.structuredContent, `binding request ${bindingId}`).toMatchObject({
          binding: { bindingId, status: 'queued' }
        });
      }

      await vi.waitFor(
        async () => {
          const failed = await api.client.callTool({
            name: 'agentcanvas_mediatools__get_binding',
            arguments: { bindingId: 'failed-1' }
          });
          const rejected = await api.client.callTool({
            name: 'agentcanvas_mediatools__get_binding',
            arguments: { bindingId: 'outside-1' }
          });
          expect(failed.structuredContent).toMatchObject({
            binding: {
              status: 'failed',
              error: {
                code: 'mediatools_job_failed',
                message: 'Image generation failed. Attach a different job to try again.'
              }
            }
          });
          expect(rejected.structuredContent).toMatchObject({
            binding: {
              status: 'failed',
              error: {
                code: 'mediatools_output_rejected',
                message: 'The completed image is not admitted by Filesystem Images.'
              }
            }
          });
        },
        { timeout: 7500, interval: 100 }
      );

      const projection = await (await app.request(`/api/v1/canvases/${canvasId}`)).json();
      expect(projection.elementRuntime.gallery.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'failed-1',
            state: 'failed',
            message: 'Image generation failed. Attach a different job to try again.'
          }),
          expect.objectContaining({
            id: 'outside-1',
            state: 'failed',
            message: 'The completed image is not admitted by Filesystem Images.'
          })
        ])
      );
      expect(JSON.stringify(projection)).not.toContain(fixture.root);
      const cover = await api.client.callTool({
        name: 'agentcanvas_gallery__set_cover',
        arguments: {
          canvasId,
          elementId: 'gallery',
          itemId: 'failed-1'
        }
      });
      expect(cover.isError).not.toBe(true);
      const snapshot = await (await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' })).json();
      const svg = await (await app.request(snapshot.snapshot.url)).text();
      expect(svg).toContain('Image generation failed. Attach a different job to try again.');
      expect(svg).not.toContain(fixture.root);
    } finally {
      await api.client.close();
      await api.server.server.close();
      runtime.dispose();
      await media.close();
      if (originalToken === undefined) delete process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN;
      else process.env.AGENT_CANVAS_MEDIATOOLS_TOKEN = originalToken;
    }
  }, 20_000);
});
