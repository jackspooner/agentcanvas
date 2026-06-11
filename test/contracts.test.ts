import { describe, expect, it } from 'vitest';
import { normalizeCanvasElement, resolveAssetContentUrl, validateAssetRef } from '../src/validation';

describe('canvas contracts and validation', () => {
  it('accepts markdown elements', () => {
    const element = normalizeCanvasElement({
      id: 'notes',
      type: 'markdown',
      x: 10,
      y: 20,
      width: 320,
      height: 180,
      markdown: '# Notes\n\n- item'
    });
    expect(element.type).toBe('markdown');
    if (element.type !== 'markdown') throw new Error('expected markdown element');
    expect(element.markdown).toContain('Notes');
  });

  it('rejects overlong markdown elements', () => {
    expect(() => normalizeCanvasElement({
      id: 'too-big',
      type: 'markdown',
      x: 0,
      y: 0,
      markdown: 'x'.repeat(20001)
    })).toThrow(/markdown/i);
  });

  it('rejects local paths as asset refs', () => {
    expect(() => validateAssetRef('C:/tmp/image.png')).toThrow(/asset ref/i);
  });

  it('resolves Assets-2 content URLs server-side', () => {
    const url = resolveAssetContentUrl({
      type: 'asset',
      project: 'demo',
      assetId: '00000000-0000-4000-8000-000000000000',
      assetBaseUrl: 'http://127.0.0.1:23000'
    });
    expect(url).toBe('http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000000/content');
  });
});
