import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EmbedSessionRegistry } from '../src/embed-sessions';
import { createV2App, createV2Runtime } from '../src/server-v2';

const roots: string[] = [];

function emptyPluginsRoot(): string {
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'agentcanvas-embed-plugins-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('embed sessions', () => {
  it('enforces explicit canvas scope, parent origin, expiry, and revocation', () => {
    let now = Date.parse('2026-07-28T12:00:00.000Z');
    const registry = new EmbedSessionRegistry('http://127.0.0.1:23003', () => now);
    const existing = new Set(['canvas_1', 'canvas_2']);
    const created = registry.create(
      {
        canvasIds: ['canvas_1', 'canvas_2'],
        mode: 'read',
        parentOrigin: 'HTTPS://APP.EXAMPLE.TEST',
        expiresInSeconds: 60
      },
      (canvasId) => {
        if (!existing.has(canvasId)) throw new Error('missing canvas');
      }
    );
    const token = new URL(created.url).pathname.split('/').pop() as string;
    expect(created.session).toMatchObject({
      canvasIds: ['canvas_1', 'canvas_2'],
      mode: 'read',
      parentOrigin: 'https://app.example.test'
    });
    expect(registry.select(token, 'canvas_2').canvasId).toBe('canvas_2');
    expect(() => registry.select(token, 'canvas_3')).toThrowError(
      expect.objectContaining({ code: 'embed_canvas_forbidden', status: 403 })
    );

    now += 60_000;
    expect(() => registry.get(token)).toThrowError(
      expect.objectContaining({ code: 'embed_session_expired', status: 410 })
    );

    const revocable = registry.create(
      {
        canvasIds: ['canvas_1'],
        mode: 'edit',
        parentOrigin: 'http://127.0.0.1:3000',
        expiresInSeconds: 60
      },
      () => undefined
    );
    const revocableToken = new URL(revocable.url).pathname.split('/').pop() as string;
    expect(registry.revoke(revocableToken).mode).toBe('edit');
    expect(() => registry.get(revocableToken)).toThrowError(
      expect.objectContaining({ code: 'embed_session_not_found', status: 404 })
    );
  });

  it('exposes one registry-owned HTTP and OpenAPI contract for multi-canvas embeds', async () => {
    const runtime = await createV2Runtime({
      pluginsRoot: emptyPluginsRoot(),
      databasePath: ':memory:',
      config: { publicBaseUrl: 'http://127.0.0.1:23003' }
    });
    const app = createV2App(runtime);
    const createCanvas = async (title: string) =>
      (
        await (
          await app.request('/api/v1/canvases', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title })
          })
        ).json()
      ).canvas.id as string;
    const canvasIds = [await createCanvas('One'), await createCanvas('Two')];
    const outsideCanvasId = await createCanvas('Outside');

    const createdResponse = await app.request('/api/v1/embed-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canvasIds,
        mode: 'edit',
        parentOrigin: 'http://127.0.0.1:3000',
        expiresInSeconds: 3600
      })
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const token = new URL(created.url).pathname.split('/').pop() as string;
    expect(created).toMatchObject({
      ok: true,
      session: { canvasIds, mode: 'edit', parentOrigin: 'http://127.0.0.1:3000' }
    });

    const selected = await (
      await app.request(`/api/v1/embed-sessions/${token}?canvasId=${encodeURIComponent(canvasIds[1])}`)
    ).json();
    expect(selected).toMatchObject({
      ok: true,
      readOnly: false,
      canvas: { id: canvasIds[1] },
      session: { canvasIds }
    });
    const forbidden = await app.request(
      `/api/v1/embed-sessions/${token}?canvasId=${encodeURIComponent(outsideCanvasId)}`
    );
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe('embed_canvas_forbidden');

    const openapi = await (await app.request('/openapi.json')).json();
    expect(openapi.paths['/api/v1/embed-sessions'].post).toMatchObject({
      operationId: 'embedSessionCreate',
      tags: ['Embedding']
    });
    expect(openapi.paths['/api/v1/embed-sessions/{token}'].get['x-agent-notes']).toBeDefined();

    expect((await app.request(`/api/v1/embed-sessions/${token}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/v1/embed-sessions/${token}`)).status).toBe(404);
    runtime.store.close();
  });
});
