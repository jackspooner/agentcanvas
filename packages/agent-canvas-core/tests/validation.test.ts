import { describe, expect, it } from 'vitest';

import { normalizeCanvasElement, resolveAssetContentUrl, validateAssetRef } from '../src/index.js';

describe('AgentCanvasCore asset refs', () => {
  it('accepts assetId refs with non-localhost base URLs', () => {
    const ref = validateAssetRef({
      type: 'asset',
      project: 'scratch',
      assetId: '00000000-0000-4000-8000-000000000000',
      assetBaseUrl: 'http://assets.example.test:23000'
    });

    expect(ref.assetBaseUrl).toBe('http://assets.example.test:23000');
    expect(resolveAssetContentUrl(ref)).toBe('http://assets.example.test:23000/projects/scratch/assets/00000000-0000-4000-8000-000000000000/content');
  });

  it('accepts assetKey-only refs for portable canvas elements', () => {
    const element = normalizeCanvasElement({
      id: 'asset_1',
      type: 'asset',
      x: 0,
      y: 0,
      assetRef: {
        type: 'asset',
        project: 'scratch',
        assetKey: 'one-off/tool/output-v1'
      }
    });

    expect(element.type).toBe('asset');
    if (element.type === 'asset') expect(element.assetRef.assetKey).toBe('one-off/tool/output-v1');
  });

  it('rejects refs without assetId or assetKey', () => {
    expect(() => validateAssetRef({ type: 'asset', project: 'scratch' })).toThrow(/assetId or assetKey/);
  });
});
