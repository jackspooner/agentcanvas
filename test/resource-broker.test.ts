import { describe, expect, it, vi } from 'vitest';
import { ResourceBroker } from '../src/resources/broker';

describe('opaque resource broker', () => {
  it('evicts without reads, retains live resources, and disposes its timer', () => {
    vi.useFakeTimers();
    const broker = new ResourceBroker();
    try {
      const live = broker.registerBytes(new Uint8Array([1]), { mimeType: 'image/png', ttlMs: 100 });
      broker.registerBytes(new Uint8Array([2]), { mimeType: 'image/png', ttlMs: 10 });
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(10);
      // Nothing remains for explicit pruning: the timer already released the expired registration.
      expect(broker.pruneExpired()).toBe(0);
      expect(broker.details(live.handle)).not.toBeNull();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(90);
      expect(broker.pruneExpired()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      broker.registerBytes(new Uint8Array([3]), { mimeType: 'image/png' });
      broker.dispose();
      broker.dispose();
      expect(vi.getTimerCount()).toBe(0);
      expect(broker.details(live.handle)).toBeNull();
      expect(() => broker.registerBytes(new Uint8Array([4]), { mimeType: 'image/png' })).toThrow(/disposed/);
    } finally {
      broker.dispose();
      vi.useRealTimers();
    }
  });

  it('returns compact handles and verifies bounded bytes without data URLs', async () => {
    const broker = new ResourceBroker();
    const handle = broker.registerBytes(new TextEncoder().encode('<svg/>'), { mimeType: 'image/svg+xml' });
    expect(handle.url).toBe(`/api/v1/resources/${handle.handle}/content`);
    expect(JSON.stringify(handle)).not.toContain('data:');
    expect(broker.details(handle.handle)).toMatchObject({ mimeType: 'image/svg+xml', byteLength: 6 });
    const payload = await broker.load(handle.handle, new AbortController().signal);
    expect(new TextDecoder().decode(payload?.bytes)).toBe('<svg/>');
  });

  it('expires handles and rejects unbounded or unsafe content', async () => {
    let current = 100;
    const broker = new ResourceBroker({ maxBytes: 4, defaultTtlMs: 10, now: () => current });
    expect(() => broker.registerBytes(new Uint8Array(5), { mimeType: 'image/png' })).toThrow(/exceeds/);
    expect(() => broker.registerBytes(new Uint8Array(1), { mimeType: 'text/html' })).toThrow(/not allowed/);
    const handle = broker.registerBytes(new Uint8Array([1]), { mimeType: 'image/png' });
    current = 111;
    expect(broker.details(handle.handle)).toBeNull();
    await expect(broker.load(handle.handle, new AbortController().signal)).resolves.toBeNull();
  });

  it('refreshes mutable provider metadata while retaining the handle', async () => {
    let bytes = Uint8Array.from([1, 2]);
    const broker = new ResourceBroker();
    const handle = broker.register({
      mimeType: 'model/gltf-binary',
      byteLength: bytes.byteLength,
      mutable: true,
      load: async () => ({ bytes, mimeType: 'model/gltf-binary' })
    });

    await expect(broker.load(handle.handle, new AbortController().signal)).resolves.toMatchObject({ bytes });
    const firstDetails = broker.details(handle.handle);
    expect(firstDetails).toMatchObject({ byteLength: 2, sha256: expect.any(String) });

    bytes = Uint8Array.from([3, 4, 5, 6]);
    await expect(broker.load(handle.handle, new AbortController().signal)).resolves.toMatchObject({ bytes });
    expect(broker.details(handle.handle)).toMatchObject({ byteLength: 4, sha256: expect.any(String) });
    expect(broker.details(handle.handle)?.sha256).not.toBe(firstDetails?.sha256);
  });
});
