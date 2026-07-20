import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createV2App, createV2Runtime } from '../src/server-v2';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function copyDistribution(pluginsRoot: string, sourceName: string, pluginId: string): string {
  const source = path.resolve('plugin-packages', sourceName);
  const destination = path.join(pluginsRoot, pluginId);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['agentcanvas.plugin.json', 'LICENSE', 'README.md']) {
    fs.copyFileSync(path.join(source, name), path.join(destination, name));
  }
  fs.cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
  fs.cpSync(path.join(source, 'src'), path.join(destination, 'src'), { recursive: true });
  return destination;
}

function galleryFixture(includeFilesystemProvider = true): { pluginsRoot: string } {
  const temporaryParent = path.resolve('tmp');
  fs.mkdirSync(temporaryParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryParent, 'agentcanvas-gallery-runtime-'));
  temporaryRoots.push(root);
  const pluginsRoot = path.join(root, 'plugins');
  fs.mkdirSync(pluginsRoot, { recursive: true });
  copyDistribution(pluginsRoot, 'gallery', 'agentcanvas.gallery');
  if (includeFilesystemProvider) {
    const imageRoot = path.join(root, 'images');
    const pluginRoot = copyDistribution(pluginsRoot, 'filesystem-images', 'agentcanvas.filesystem-images');
    fs.mkdirSync(imageRoot, { recursive: true });
    fs.cpSync(path.resolve('plugin-packages', 'filesystem-images', 'schemas'), path.join(pluginRoot, 'schemas'), {
      recursive: true
    });
    fs.writeFileSync(
      path.join(pluginRoot, 'plugin.config.json'),
      JSON.stringify({ roots: [{ id: 'images', path: imageRoot }], contentMaxBytes: 1024, resourceTtlMs: 60_000 })
    );
    fs.writeFileSync(path.join(imageRoot, 'first.png'), Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    fs.writeFileSync(path.join(imageRoot, 'second.png'), Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 2]));
  }
  return { pluginsRoot };
}

async function createCanvas(app: ReturnType<typeof createV2App>): Promise<string> {
  const response = await app.request('/api/v1/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Gallery runtime' })
  });
  const created = await response.json();
  return created.canvas.id as string;
}

function galleryElement(canvasId: string) {
  return {
    canvasId,
    id: 'gallery',
    items: [
      {
        id: 'first',
        source: {
          provider: 'agentcanvas.filesystem-images',
          reference: { rootId: 'images', path: 'first.png' }
        },
        alt: 'First image'
      },
      {
        id: 'second',
        source: {
          provider: 'agentcanvas.filesystem-images',
          reference: { rootId: 'images', path: 'second.png' }
        },
        caption: 'Second image'
      }
    ],
    x: 20,
    y: 30
  };
}

describe('Media Gallery runtime', () => {
  it('resolves filesystem-backed items through the host image-source registry and snapshots the cover', async () => {
    const fixture = galleryFixture();
    const runtime = await createV2Runtime({
      pluginsRoot: fixture.pluginsRoot,
      databasePath: ':memory:',
      config: { publicBaseUrl: 'http://127.0.0.1:23003' }
    });
    const app = createV2App(runtime);
    const canvasId = await createCanvas(app);
    const element = {
      id: 'gallery',
      type: 'agentcanvas.gallery/gallery',
      schemaVersion: 1,
      x: 20,
      y: 30,
      width: 480,
      height: 320,
      data: {
        items: galleryElement(canvasId).items,
        presentation: 'carousel',
        fit: 'contain',
        initialIndex: 1,
        autoplay: false,
        intervalMs: 5000,
        showControls: true,
        showIndicators: true
      }
    };
    const createResponse = await app.request(`/api/v1/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'upsertElement', element }] })
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(200);
    const created = await createResponse.json();
    expect(created.diagnostics).toEqual([]);
    expect(created.elementRuntime.gallery.items).toHaveLength(2);

    const second = created.elementRuntime.gallery.items.find((item: { id: string }) => item.id === 'second');
    const content = await app.request(second.contentUrl);
    expect(content.status).toBe(200);
    expect(Array.from(new Uint8Array(await content.arrayBuffer()))).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 2]);

    const snapshotResponse = await app.request(`/api/v1/canvases/${canvasId}/snapshot`, { method: 'POST' });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = await snapshotResponse.json();
    expect(snapshot.diagnostics).toEqual([]);
    const svg = await (await app.request(snapshot.snapshot.url)).text();
    expect(svg).toMatch(/href="\/api\/v1\/resources\/res_[A-Za-z0-9_-]+\/content"/);
    expect(svg).toContain('aria-label="Second image"');
    expect(svg).toContain('2 / 2');
    runtime.store.close();
  });

  it('preserves galleries and reports diagnostics when their source provider is not installed', async () => {
    const fixture = galleryFixture(false);
    const runtime = await createV2Runtime({
      pluginsRoot: fixture.pluginsRoot,
      databasePath: ':memory:',
      config: { publicBaseUrl: 'http://127.0.0.1:23003' }
    });
    const app = createV2App(runtime);
    const canvasId = await createCanvas(app);
    const element = {
      id: 'gallery',
      type: 'agentcanvas.gallery/gallery',
      schemaVersion: 1,
      x: 0,
      y: 0,
      width: 480,
      height: 320,
      data: {
        items: galleryElement(canvasId).items,
        presentation: 'carousel',
        fit: 'contain',
        initialIndex: 0,
        autoplay: false,
        intervalMs: 5000,
        showControls: true,
        showIndicators: true
      }
    };
    const response = await app.request(`/api/v1/canvases/${canvasId}/elements:batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'upsertElement', element }] })
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const projection = await response.json();
    expect(projection.canvas.elements).toEqual([element]);
    expect(projection.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'gallery_image_provider_unavailable', pluginId: 'agentcanvas.gallery' })
      ])
    );
    runtime.store.close();
  });
});
