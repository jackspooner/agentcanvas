import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResourceRegistration, SnapshotResourcesCapabilityV1 } from '@agentcanvas/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSystemImageSourceResolver, normalizeRelativeImagePath } from '../src/filesystem.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcanvas-filesystem-images-'));
  roots.push(root);
  return root;
}

describe('filesystem image source', () => {
  it('rejects absolute paths, traversal, backslashes, and unsupported file types', () => {
    for (const value of ['/image.png', '../image.png', 'folder\\image.png', 'C:/image.png', 'image.svg']) {
      expect(() => normalizeRelativeImagePath(value)).toThrow();
    }
    expect(normalizeRelativeImagePath('products/mug.PNG')).toBe('products/mug.PNG');
  });

  it('registers a linked resource and re-reads current bytes through the broker', async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'products'));
    const imagePath = path.join(root, 'products', 'mug.png');
    fs.writeFileSync(imagePath, Uint8Array.from([1, 2, 3]));
    let registration: ResourceRegistration | undefined;
    const resources: SnapshotResourcesCapabilityV1 = {
      register: vi.fn((value) => {
        registration = value;
        return {
          handle: 'res_abcdefghijklmnopqrstuvwxyzABCDEF',
          url: '/api/v1/resources/res_abcdefghijklmnopqrstuvwxyzABCDEF/content',
          mimeType: value.mimeType
        };
      }),
      details: vi.fn(),
      load: vi.fn()
    };
    const resolver = await FileSystemImageSourceResolver.create(
      { roots: [{ id: 'pictures', path: root }], contentMaxBytes: 1024, resourceTtlMs: 1000 },
      resources
    );
    const result = await resolver.resource(
      { rootId: 'pictures', path: 'products/mug.png' },
      new AbortController().signal
    );
    expect(result).toMatchObject({ mimeType: 'image/png', byteLength: 3 });
    expect(resolver.listRoots()).toEqual([{ id: 'pictures' }]);
    fs.writeFileSync(imagePath, Uint8Array.from([4, 5, 6, 7]));
    expect(Array.from((await registration?.load(new AbortController().signal))?.bytes ?? [])).toEqual([4, 5, 6, 7]);
  });

  it('does not accept a source outside an allowlisted root', async () => {
    const root = tempRoot();
    const resources = { register: vi.fn(), details: vi.fn(), load: vi.fn() } as SnapshotResourcesCapabilityV1;
    const resolver = await FileSystemImageSourceResolver.create(
      { roots: [{ id: 'pictures', path: root }], contentMaxBytes: 1024, resourceTtlMs: 1000 },
      resources
    );
    expect(() => resolver.validateSource({ rootId: 'other', path: 'image.png' })).toThrow('not allowlisted');
  });
});
