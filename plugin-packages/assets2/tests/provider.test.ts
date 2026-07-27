import type { ResourceRegistration, SnapshotResourcesCapabilityV1 } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { Assets2Capability } from '../src/provider.js';

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

function resourceBroker(registrations: ResourceRegistration[]): SnapshotResourcesCapabilityV1 {
  const details = new Map<string, ReturnType<SnapshotResourcesCapabilityV1['details']>>();
  return {
    register(registration) {
      registrations.push(registration);
      const handle = {
        handle: `resource_${registrations.length}`,
        url: `/api/v1/resources/resource_${registrations.length}/content`,
        mimeType: registration.mimeType,
        ...(registration.byteLength !== undefined ? { byteLength: registration.byteLength } : {}),
        ...(registration.width !== undefined ? { width: registration.width } : {}),
        ...(registration.height !== undefined ? { height: registration.height } : {})
      };
      details.set(handle.handle, { ...handle, createdAt: '2026-07-13T00:00:00.000Z' });
      return handle;
    },
    details: (handle) => details.get(handle) ?? null,
    load: async () => null
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Assets2Capability', () => {
  it('requires exact provider identity and advertised asset capabilities', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: 'ok' }))
      .mockResolvedValueOnce(
        json({ service: 'asset-service', capabilities: { asset_crud: true, asset_refs: true, other: false } })
      );
    const capability = new Assets2Capability(config, resourceBroker([]), fetcher);
    await expect(capability.providerStatus()).resolves.toEqual({
      ok: true,
      identity: 'asset-service',
      capabilities: ['asset_crud', 'asset_refs']
    });
  });

  it('reports identity and capability failures without accepting lookalike services', async () => {
    const wrongIdentity = new Assets2Capability(
      config,
      resourceBroker([]),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ status: 'ok' }))
        .mockResolvedValueOnce(
          json({ service: 'asset-service-proxy', capabilities: { asset_crud: true, asset_refs: true } })
        )
    );
    await expect(wrongIdentity.providerStatus()).resolves.toMatchObject({
      ok: false,
      code: 'assets_identity_mismatch'
    });

    const missingCapability = new Assets2Capability(
      config,
      resourceBroker([]),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ status: 'ok' }))
        .mockResolvedValueOnce(json({ service: 'asset-service', capabilities: { asset_crud: true } }))
    );
    await expect(missingCapability.providerStatus()).resolves.toMatchObject({
      ok: false,
      code: 'assets_capabilities_missing'
    });
  });

  it('registers bounded safe media with the shared opaque resource broker', async () => {
    const registrations: ResourceRegistration[] = [];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          project: 'demo',
          id: reference.assetId,
          content_type: 'image/png',
          size_bytes: bytes.byteLength,
          image_width_px: 64,
          image_height_px: 32,
          metadata: {}
        })
      )
      .mockResolvedValueOnce(
        json({
          project: 'demo',
          id: reference.assetId,
          content_type: 'image/png',
          size_bytes: bytes.byteLength,
          image_width_px: 64,
          image_height_px: 32,
          metadata: {}
        })
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) }
        })
      );
    const capability = new Assets2Capability(config, resourceBroker(registrations), fetcher);
    const handle = await capability.contentHandle(
      capability.validateReference(reference),
      new AbortController().signal
    );
    expect(handle).toMatchObject({
      handle: 'resource_1',
      url: '/api/v1/resources/resource_1/content',
      mimeType: 'image/png',
      byteLength: 4,
      width: 64,
      height: 32
    });
    await expect(
      capability.contentHandle(capability.validateReference(reference), new AbortController().signal)
    ).resolves.toBe(handle);
    expect(registrations).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(registrations[0].load(new AbortController().signal)).resolves.toEqual({
      bytes,
      mimeType: 'image/png',
      width: 64,
      height: 32
    });
  });

  it.each([
    'video/mp4',
    'video/webm',
    'model/gltf-binary',
    'model/gltf+json'
  ])('supports %s for dependent video and GLB plugins', async (mimeType) => {
    const registrations: ResourceRegistration[] = [];
    const capability = new Assets2Capability(
      config,
      resourceBroker(registrations),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({ project: 'demo', id: reference.assetId, content_type: mimeType, size_bytes: 10, metadata: {} })
        )
    );
    await capability.contentHandle(capability.validateReference(reference), new AbortController().signal);
    expect(registrations[0].mimeType).toBe(mimeType);
  });

  it('coalesces concurrent stable-reference registrations', async () => {
    let releaseMetadata!: () => void;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (!(new URL(input as string).pathname.endsWith('/content'))) await metadataGate;
      return json({
        project: 'demo',
        id: reference.assetId,
        content_type: 'model/gltf-binary',
        size_bytes: 4,
        metadata: {}
      });
    });
    const registrations: ResourceRegistration[] = [];
    const capability = new Assets2Capability(config, resourceBroker(registrations), fetcher);
    const first = capability.contentHandle(capability.validateReference(reference), new AbortController().signal);
    const second = capability.contentHandle(capability.validateReference(reference), new AbortController().signal);
    releaseMetadata();
    await expect(Promise.all([first, second])).resolves.toEqual([expect.any(Object), expect.any(Object)]);
    expect(registrations).toHaveLength(1);
  });

  it('rejects per-reference provider overrides outside the configured Assets-2 URL', () => {
    const capability = new Assets2Capability(config, resourceBroker([]), vi.fn());
    expect(() => capability.validateReference({ ...reference, assetBaseUrl: 'https://evil.example' })).toThrow(
      'does not match'
    );
  });

  it('resolves bounded JSON from asset content rather than metadata', async () => {
    const document = { schema: 'bbox-layout/v1', canvasWidth: 100, canvasHeight: 80, boxes: [] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } })
      );
    const capability = new Assets2Capability(config, resourceBroker([]), fetcher);
    await expect(
      capability.boundedJson(capability.validateReference(reference), new AbortController().signal)
    ).resolves.toEqual(document);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: expect.stringMatching(/\/content$/) }),
      expect.any(Object)
    );
  });

  it('inspects bounded legacy raster bytes when intrinsic dimensions are not recorded', async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    const view = new DataView(png.buffer);
    view.setUint32(16, 640, false);
    view.setUint32(20, 480, false);
    const capability = new Assets2Capability(
      config,
      resourceBroker([]),
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({ project: 'demo', id: reference.assetId, content_type: 'image/png', metadata: {} })
        )
        .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }))
    );
    await expect(
      capability.details(capability.validateReference(reference), new AbortController().signal)
    ).resolves.toMatchObject({ asset: { width: 640, height: 480 } });
  });
});
