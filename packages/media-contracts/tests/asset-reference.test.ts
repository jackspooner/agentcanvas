import { describe, expect, it } from 'vitest';

import {
  assetContentPath,
  assetIdentityKey,
  normalizeAssetReference,
  redactAgentBinaryPayload,
  resolveAssetContentUrl,
  withAssetBaseUrl
} from '../src/index.js';

describe('AssetReference', () => {
  it('accepts either a UUID assetId or a project-scoped assetKey', () => {
    const byId = normalizeAssetReference({
      type: 'asset',
      project: 'scratch',
      assetId: '00000000-0000-4000-8000-000000000000'
    });
    const byKey = normalizeAssetReference({
      type: 'asset',
      project: 'scratch',
      assetKey: 'one-off/tool/output-v1',
      assetBaseUrl: 'http://assets.example.test:23000'
    });

    expect(byId.assetId).toBe('00000000-0000-4000-8000-000000000000');
    expect(byKey.assetKey).toBe('one-off/tool/output-v1');
    expect(byKey.assetBaseUrl).toBe('http://assets.example.test:23000');
  });

  it('rejects refs without a durable identity', () => {
    expect(() => normalizeAssetReference({ type: 'asset', project: 'scratch' })).toThrow(/assetId or assetKey/);
  });

  it('does not treat assetBaseUrl as part of durable identity', () => {
    const left = normalizeAssetReference({
      type: 'asset',
      project: 'scratch',
      assetId: '00000000-0000-4000-8000-000000000000',
      assetBaseUrl: 'http://127.0.0.1:23000'
    });
    const right = withAssetBaseUrl(left, 'http://assets.example.test:23000');

    expect(assetIdentityKey(left)).toBe(assetIdentityKey(right));
  });

  it('builds content URLs for UUID and key refs without requiring localhost', () => {
    expect(
      resolveAssetContentUrl(
        {
          type: 'asset',
          project: 'scratch',
          assetId: '00000000-0000-4000-8000-000000000000'
        },
        'http://assets.example.test:23000'
      )
    ).toBe('http://assets.example.test:23000/projects/scratch/assets/00000000-0000-4000-8000-000000000000/content');

    expect(
      assetContentPath({
        type: 'asset',
        project: 'scratch',
        assetKey: 'one-off/tool/output-v1'
      })
    ).toBe('/projects/scratch/assets/by-key/one-off/tool/output-v1/content');
  });

  it('redacts agent-facing binary payloads into compact descriptors', () => {
    expect(redactAgentBinaryPayload('data:image/png;base64,AAAA')).toEqual({
      kind: 'data-url',
      mediaType: 'image/png',
      encodedBytes: 4,
      redacted: true
    });
  });
});
