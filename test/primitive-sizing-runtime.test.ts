import fs from 'node:fs';
import path from 'node:path';
import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpV2Server } from '../src/mcp-v2/server.js';
import { inspectCanvas } from '../src/plugin-runtime/inspection.js';
import { createV2Runtime } from '../src/server-v2.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  fs.mkdirSync(path.resolve('tmp'), { recursive: true });
  const pluginsRoot = fs.mkdtempSync(path.resolve('tmp', 'primitive-sizing-'));
  roots.push(pluginsRoot);
  for (const name of ['primitives', 'markdown']) {
    const source = path.resolve('plugin-packages', name);
    const destination = path.join(pluginsRoot, `agentcanvas.${name}`);
    fs.mkdirSync(destination);
    fs.copyFileSync(path.join(source, 'agentcanvas.plugin.json'), path.join(destination, 'agentcanvas.plugin.json'));
    fs.cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
    fs.cpSync(path.join(source, 'src'), path.join(destination, 'src'), { recursive: true });
  }
  const runtime = await createV2Runtime({ pluginsRoot, databasePath: ':memory:' });
  const { server } = createMcpV2Server({
    ...runtime,
    publicBaseUrl: runtime.config.publicBaseUrl,
    diagnostics: () => []
  });
  const client = new Client({ name: 'primitive-sizing-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const canvas = runtime.store.createCanvas({ title: 'Sizing regression' });
  return { runtime, server, client, canvas };
}

describe('primitive sizing through MCP and persistence', () => {
  it('persists all five reported inputs at the estimated heights and reports growth overlaps', async () => {
    const { runtime, server, client, canvas } = await fixture();
    try {
      const cases: [string, JsonObject, number][] = [
        [
          'text',
          {
            width: 1500,
            height: 76,
            text: 'MCP boundaries — current state vs user-requested direction',
            style: { fontSize: 36 }
          },
          79
        ],
        [
          'text',
          {
            width: 1500,
            height: 38,
            text: 'Supplied discussion snapshot · 17 Sep 2026 · teal = retained/owned · amber = change or decision',
            style: { fontSize: 16 }
          },
          51
        ],
        ['text', { width: 620, height: 42, text: 'CURRENT STATE (supplied snapshot)', style: { fontSize: 22 } }, 59],
        [
          'text',
          { width: 620, height: 42, text: 'USER-REQUESTED DIRECTION + RECOMMENDED FOLLOW-UP', style: { fontSize: 22 } },
          90
        ],
        ['shape', { width: 240, height: 80, shape: 'rect', label: 'ImageOperationTools MCP\n+ mini-runner' }, 96]
      ];
      for (const [index, [name, input, height]] of cases.entries()) {
        const result = await client.callTool({
          name: `agentcanvas_primitives__add_${name}`,
          arguments: { canvasId: canvas.id, id: `reported_${index}`, x: -700, y: index * 200, ...input }
        });
        expect(result.isError).not.toBe(true);
        expect(
          runtime.store.getCanvas(canvas.id).elements.find((element) => element.id === `reported_${index}`)
        ).toMatchObject({ x: -700, y: index * 200, width: input.width, height });
        expect(result.structuredContent).toMatchObject({
          inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
        });
      }
      // Requested 20px frames would not overlap; growing the first to 79px crosses the second's y=60.
      await client.callTool({
        name: 'agentcanvas_primitives__add_text',
        arguments: {
          canvasId: canvas.id,
          id: 'grow',
          x: 2000,
          y: 0,
          width: 400,
          height: 20,
          text: 'Title',
          style: { fontSize: 36 }
        }
      });
      const overlapping = await client.callTool({
        name: 'agentcanvas_primitives__add_shape',
        arguments: { canvasId: canvas.id, id: 'neighbor', x: 2000, y: 60, width: 400, height: 20, shape: 'rect' }
      });
      expect(overlapping.structuredContent).toMatchObject({ inspectionSummary: { warningCount: 1 } });
      expect(inspectCanvas(runtime.store.getCanvas(canvas.id), runtime.registry).diagnostics).toEqual([
        expect.objectContaining({ code: 'element_frames_overlap', elementId: 'neighbor' })
      ]);
    } finally {
      await client.close();
      await server.close();
      runtime.dispose();
    }
  });

  it('preserves defaults, larger frames, deliberate clipping, connectors and generic frame writes', async () => {
    const { runtime, server, client, canvas } = await fixture();
    try {
      const cases: [string, JsonObject, number][] = [
        ['text', { text: 'Short' }, 100],
        ['text', { text: 'Short', height: null }, 100],
        ['text', { text: 'Short', height: 200 }, 200],
        ['text', { text: '', height: 20 }, 20],
        ['text', { text: 'Heading', height: 20, allowClipping: true }, 20],
        ['text', { text: 'A\nB\nC\nD\nE' }, 140],
        ['text', { text: 'A\nB\nC\nD\nE', height: null }, 140],
        ['text', { text: 'A'.repeat(100), width: 100, height: 20 }, 364],
        ['shape', { shape: 'rect', label: 'Short' }, 160],
        ['shape', { shape: 'rect', label: 'Short', height: null }, 160],
        ['shape', { shape: 'rect', label: 'Short', height: 200 }, 200],
        ['shape', { shape: 'rect', label: '', height: 20 }, 20],
        ['shape', { shape: 'rect', label: 'Heading', height: 20, allowClipping: true }, 20],
        ['shape', { shape: 'rect', label: 'A\nB\nC\nD\nE\nF' }, 163],
        ['shape', { shape: 'rect', label: 'A\nB\nC\nD\nE\nF', height: null }, 163],
        ...['line', 'arrow'].map((name): [string, JsonObject, number] => [
          name,
          { label: 'Long\nconnector\nlabel', height: 0, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
          0
        ])
      ];
      for (const [index, [name, input, height]] of cases.entries()) {
        const result = await client.callTool({
          name: `agentcanvas_primitives__add_${name}`,
          arguments: { canvasId: canvas.id, id: `case_${index}`, x: 10, y: index * 500, width: 240, ...input }
        });
        expect(result.isError).not.toBe(true);
        expect(
          runtime.store.getCanvas(canvas.id).elements.find((element) => element.id === `case_${index}`)
        ).toMatchObject({ x: 10, y: index * 500, width: input.width ?? 240, height });
      }
      const patch = await client.callTool({
        name: 'canvas_patch_element_frame',
        arguments: { canvasId: canvas.id, elementId: 'case_0', frame: { height: 10 } }
      });
      expect(patch.isError).not.toBe(true);
      expect(runtime.store.getCanvas(canvas.id).elements.find((element) => element.id === 'case_0')?.height).toBe(10);
      expect(inspectCanvas(runtime.store.getCanvas(canvas.id), runtime.registry).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'literal_text_may_clip', elementId: 'case_0' })
      );
      const generic = await client.callTool({
        name: 'canvas_upsert_element',
        arguments: {
          canvasId: canvas.id,
          element: {
            id: 'generic',
            type: 'agentcanvas.primitives/text',
            schemaVersion: 1,
            x: 1000,
            y: 0,
            width: 240,
            height: 10,
            data: { text: 'Heading' }
          }
        }
      });
      expect(generic.isError).not.toBe(true);
      expect(runtime.store.getCanvas(canvas.id).elements.find((element) => element.id === 'generic')?.height).toBe(10);
    } finally {
      await client.close();
      await server.close();
      runtime.dispose();
    }
  });

  it('returns corrective validation problems without persisting rejected input', async () => {
    const { runtime, server, client, canvas } = await fixture();
    try {
      for (const [name, input, message] of [
        ['agentcanvas_primitives__add_text', { text: 'Research &amp; Planning' }, 'text is literal text'],
        [
          'agentcanvas_primitives__add_shape',
          { shape: 'rect', label: 'Research &amp; Planning' },
          'label is literal text'
        ],
        ['agentcanvas_markdown__add_document', { markdown: '# Heading', height: 1 }, 'Fixed Markdown frame height']
      ] as const) {
        const result = await client.callTool({ name, arguments: { canvasId: canvas.id, x: 0, y: 0, ...input } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          problem: { code: 'validation_error', status: 400, retryable: false, detail: expect.stringContaining(message) }
        });
        expect(runtime.store.getCanvas(canvas.id)).toMatchObject({ revision: canvas.revision, elements: [] });
      }
      const failure = vi.spyOn(runtime.store, 'applyOperations').mockImplementation(() => {
        throw new Error('secret-token private-path');
      });
      try {
        const result = await client.callTool({
          name: 'agentcanvas_primitives__add_text',
          arguments: { canvasId: canvas.id, x: 0, y: 0, text: 'Valid' }
        });
        expect(result.structuredContent).toMatchObject({
          problem: { code: 'internal_error', status: 500, detail: 'AgentCanvas could not complete the request.' }
        });
        expect(JSON.stringify(result)).not.toMatch(/secret-token|private-path/);
        expect(runtime.store.getCanvas(canvas.id).revision).toBe(canvas.revision);
      } finally {
        failure.mockRestore();
      }
    } finally {
      await client.close();
      await server.close();
      runtime.dispose();
    }
  });
});
