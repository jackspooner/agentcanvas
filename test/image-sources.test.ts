import type { JsonObject } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ImageSourceRegistry } from '../src/resources/image-sources.js';

const source = { provider: 'example.images', reference: { key: 'one' } };

describe('ImageSourceRegistry', () => {
  it('validates provider-owned references and resolves only image resources', async () => {
    const registry = new ImageSourceRegistry();
    const resolve = vi.fn(async () => ({
      handle: 'res_abcdefghijklmnopqrstuvwxyzABCDEF',
      url: '/api/v1/resources/res_abcdefghijklmnopqrstuvwxyzABCDEF/content',
      mimeType: 'image/png'
    }));
    registry.registerProvider({
      provider: 'example.images',
      validateReference(value) {
        const input = value as JsonObject;
        if (typeof input.key !== 'string') throw new TypeError('key is required');
        return { key: input.key };
      },
      resolve
    });

    expect(registry.listProviders()).toEqual(['example.images']);
    expect(registry.validateReference(source)).toEqual(source);
    await expect(registry.resolve(source, new AbortController().signal)).resolves.toMatchObject({
      mimeType: 'image/png'
    });
    expect(resolve).toHaveBeenCalledWith({ key: 'one' }, expect.any(AbortSignal));
    registry.seal();
    expect(() =>
      registry.registerProvider({
        provider: 'late.images',
        validateReference: () => ({}),
        resolve
      })
    ).toThrow(/sealed/);
  });

  it('rejects missing, duplicate, malformed, and non-image providers explicitly', async () => {
    const registry = new ImageSourceRegistry();
    const provider = {
      provider: 'example.images',
      validateReference: () => ({ key: 'one' }),
      resolve: async () => ({ handle: 'resource', url: '/resource', mimeType: 'video/mp4' })
    };
    registry.registerProvider(provider);
    expect(() => registry.registerProvider(provider)).toThrow(/already registered/);
    expect(() => registry.validateReference({ provider: 'missing.images', reference: {} })).toThrow(/unavailable/);
    expect(() => registry.validateReference({ ...source, extra: true })).toThrow(/unsupported/);
    await expect(registry.resolve(source, new AbortController().signal)).rejects.toThrow(/non-image/);
  });
});
