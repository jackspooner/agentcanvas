import { describe, expect, it } from 'vitest';
import { ResourceBroker } from '../src/resources/broker';

describe('opaque resource broker', () => {
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
});
