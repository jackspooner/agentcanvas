import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, '../../..');

const browserEntries = new Map([
  ['agentcanvas.primitives', 'plugin-packages/primitives/src/browser/entry.mts'],
  ['agentcanvas.markdown', 'plugin-packages/markdown/src/browser/entry.mts'],
  ['agentcanvas.table', 'plugin-packages/table/src/browser/entry.mts'],
  ['agentcanvas.assets2', 'plugin-packages/assets2/src/browser/entry.mts'],
  ['agentcanvas.gallery', 'plugin-packages/gallery/src/browser/entry.mts'],
  ['agentcanvas.image-overlays', 'plugin-packages/image-overlays/src/browser/entry.mts'],
  ['agentcanvas.video', 'plugin-packages/video/src/browser/entry.mts'],
  ['agentcanvas.glb-viewer', 'plugin-packages/glb-viewer/src/browser/entry.ts'],
  ['external.signal-card', 'test/external-plugin-fixture/src/browser/entry.mts'],
  ['fixture.fail', 'test/e2e/fixture/failing-plugin.mts']
]);

const declarations = new Map<string, Array<{ type: string; schemaVersion: number }>>([
  [
    'agentcanvas.primitives',
    ['text', 'shape', 'line', 'arrow'].map((name) => ({
      type: `agentcanvas.primitives/${name}`,
      schemaVersion: 1
    }))
  ],
  ['agentcanvas.markdown', [{ type: 'agentcanvas.markdown/document', schemaVersion: 1 }]],
  ['agentcanvas.table', [{ type: 'agentcanvas.table/table', schemaVersion: 1 }]],
  ['agentcanvas.assets2', [{ type: 'agentcanvas.assets2/asset', schemaVersion: 1 }]],
  ['agentcanvas.gallery', [{ type: 'agentcanvas.gallery/gallery', schemaVersion: 1 }]],
  [
    'agentcanvas.image-overlays',
    [
      { type: 'agentcanvas.image-overlays/bbox', schemaVersion: 1 },
      { type: 'agentcanvas.image-overlays/path', schemaVersion: 1 }
    ]
  ],
  ['agentcanvas.video', [{ type: 'agentcanvas.video/video', schemaVersion: 1 }]],
  ['agentcanvas.glb-viewer', [{ type: 'agentcanvas.glb-viewer/model', schemaVersion: 1 }]],
  ['external.signal-card', [{ type: 'external.signal-card/signal-card', schemaVersion: 1 }]],
  ['fixture.fail', [{ type: 'fixture.fail/card', schemaVersion: 1 }]]
]);

function sendJson(response: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
}

function sendBytes(response: ServerResponse, contentType: string, body: Uint8Array | string): void {
  response.statusCode = 200;
  response.setHeader('content-type', contentType);
  response.setHeader('cache-control', 'no-store');
  response.end(body);
}

function minimalGlb(): Uint8Array {
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0', generator: 'AgentCanvas e2e fixture' },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: []
    })
  );
  const padding = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const chunk = Buffer.concat([json, padding]);
  const glb = Buffer.alloc(20 + chunk.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(chunk.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(glb, 20);
  return glb;
}

function catalog() {
  return {
    plugins: [...browserEntries.keys()].map((id, index) => {
      const buildHash = (index + 1).toString(16).padStart(8, '0');
      return {
        id,
        version: '0.2.0',
        displayName: id,
        buildHash,
        browserEntryUrl: `/api/v1/plugin-modules/${id}/${buildHash}/entry.mjs`,
        elements: declarations.get(id),
        contributions: { commands: id === 'external.signal-card' ? ['toggle-status'] : [] },
        diagnostics: []
      };
    })
  };
}

function fixtureApi(): Plugin {
  return {
    name: 'agentcanvas-e2e-fixture-api',
    configureServer(server) {
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next) => {
        const pathname = new URL(request.url ?? '/', 'http://fixture.local').pathname;
        if (pathname === '/health') {
          sendJson(response, { status: 'ok' });
          return;
        }
        if (pathname === '/api/v1/plugins') {
          sendJson(response, catalog());
          return;
        }
        const moduleMatch = pathname.match(/^\/api\/v1\/plugin-modules\/([^/]+)\/[a-f0-9]{8}\/entry\.mjs$/);
        if (moduleMatch) {
          const source = browserEntries.get(decodeURIComponent(moduleMatch[1]));
          if (!source) {
            response.statusCode = 404;
            response.end();
            return;
          }
          const absoluteSource = path.resolve(repositoryRoot, source).replaceAll('\\', '/');
          response.statusCode = 302;
          response.setHeader('location', `/@fs/${absoluteSource}`);
          response.end();
          return;
        }
        if (pathname === '/fixture-resources/video.mp4') {
          sendBytes(response, 'video/mp4', new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]));
          return;
        }
        if (pathname === '/fixture-resources/model.glb') {
          sendBytes(response, 'model/gltf-binary', minimalGlb());
          return;
        }
        if (pathname === '/fixture-resources/poster.svg') {
          sendBytes(
            response,
            'image/svg+xml',
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dbeafe"/><text x="160" y="96" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#1e3a8a">Fixture poster</text></svg>'
          );
          return;
        }
        if (pathname === '/api/v1/resources/gallery-first/content') {
          sendBytes(
            response,
            'image/svg+xml',
            '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="286"><rect width="480" height="286" fill="#dbeafe"/><text x="240" y="151" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#1e3a8a">First gallery image</text></svg>'
          );
          return;
        }
        if (pathname === '/api/v1/resources/gallery-second/content') {
          sendBytes(
            response,
            'image/svg+xml',
            '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="286"><rect width="480" height="286" fill="#dcfce7"/><text x="240" y="151" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#166534">Second gallery image</text></svg>'
          );
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  root: fixtureDirectory,
  plugins: [react(), fixtureApi()],
  server: {
    fs: { allow: [repositoryRoot] }
  }
});
