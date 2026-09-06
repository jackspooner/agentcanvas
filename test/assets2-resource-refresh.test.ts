import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Assets2Capability } from '../plugin-packages/assets2/src/provider';
import { ResourceBroker } from '../src/resources/broker';

const config = {
  baseUrl: 'http://127.0.0.1:23000',
  fetchTimeoutMs: 1000,
  metadataMaxBytes: 4096,
  previewMaxBytes: 8192,
  contentMaxBytes: 1024
};

const reference = {
  type: 'asset',
  project: 'demo',
  assetId: '00000000-0000-4000-8000-000000000001'
};

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

describe('Assets-2 mutable resource delivery', () => {
  it.each([
    ['image/png', { image_width_px: 64, image_height_px: 32 }],
    ['model/gltf-binary', {}]
  ])('serves current %s bytes after stable-ID replacement', async (mimeType, dimensions) => {
    let bytes = Uint8Array.from([1, 2, 3, 4]);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const pathname = new URL(input as string).pathname;
      if (pathname.endsWith('/content')) {
        return new Response(bytes, {
          headers: { 'content-type': mimeType, 'content-length': String(bytes.byteLength) }
        });
      }
      return json({
        project: 'demo',
        id: reference.assetId,
        content_type: mimeType,
        size_bytes: bytes.byteLength,
        content_sha256: digest(bytes),
        ...dimensions,
        metadata: {}
      });
    });
    const broker = new ResourceBroker();
    const capability = new Assets2Capability(config, broker, fetcher);
    const handle = await capability.contentHandle(
      capability.validateReference(reference),
      new AbortController().signal
    );

    await expect(broker.load(handle.handle, new AbortController().signal)).resolves.toMatchObject({ bytes });
    const firstDetails = broker.details(handle.handle);
    expect(firstDetails).toMatchObject({ byteLength: 4, sha256: digest(bytes), mimeType });

    bytes = Uint8Array.from([9, 8, 7, 6, 5, 4, 3]);
    await expect(broker.load(handle.handle, new AbortController().signal)).resolves.toMatchObject({ bytes });
    expect(broker.details(handle.handle)).toMatchObject({
      byteLength: bytes.byteLength,
      sha256: digest(bytes),
      mimeType
    });
    expect(broker.details(handle.handle)?.sha256).not.toBe(firstDetails?.sha256);
  });
});
