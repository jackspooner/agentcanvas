import type { CanvasElement, SnapshotContribution } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { composeSnapshot, SnapshotSafetyError, validateSnapshotContribution } from '../src/snapshot-runtime/index.js';

function element(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: 'element-1',
    type: 'acme.cards/hello',
    schemaVersion: 1,
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    data: {},
    ...overrides
  };
}

describe('snapshot scene safety', () => {
  it('escapes text and attributes without emitting plugin HTML or SVG', () => {
    const contribution: SnapshotContribution = {
      space: 'frame',
      layer: 'content',
      nodes: [
        {
          kind: 'text',
          id: 'quoted"id',
          x: 2,
          y: 20,
          text: '<script>alert("x")</script> & words',
          fill: '#111111'
        }
      ]
    };
    const result = composeSnapshot({ items: [{ element: element(), status: 'supported', contribution }] });
    expect(result.svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; words');
    expect(result.svg).toContain('id="quoted&quot;id"');
    expect(result.svg).not.toContain('<script>');
  });

  it.each([
    { kind: 'path', d: '<svg onload=alert(1)>', fill: '#fff' },
    { kind: 'rect', x: 0, y: 0, width: 10, height: 10, fill: 'url(https://evil.example/a)' },
    { kind: 'imageHandle', x: 0, y: 0, width: 10, height: 10, handle: 'https://evil.example/a' }
  ])('rejects unsafe raw scene content', (node) => {
    expect(() => validateSnapshotContribution({ space: 'frame', layer: 'content', nodes: [node] })).toThrow(
      SnapshotSafetyError
    );
  });

  it('serializes opaque image handles only through the controlled resource route', () => {
    const result = composeSnapshot({
      items: [
        {
          element: element(),
          status: 'supported',
          contribution: {
            space: 'frame',
            layer: 'content',
            nodes: [{ kind: 'imageHandle', x: 0, y: 0, width: 200, height: 100, handle: 'opaque_12345678' }]
          }
        }
      ]
    });
    expect(result.svg).toContain('href="/api/v1/resources/opaque_12345678/content"');
    expect(result.svg).not.toContain('data:');
    expect(result.svg).not.toContain('https://');
  });

  it('turns malformed per-element scenes into visible diagnostics', () => {
    const result = composeSnapshot({
      items: [
        {
          element: element(),
          status: 'supported',
          contribution: {
            space: 'frame',
            layer: 'content',
            nodes: [{ kind: 'rect', x: 0, y: 0, width: Number.NaN, height: 10 }]
          } as SnapshotContribution
        }
      ]
    });
    expect(result.diagnostics[0].code).toBe('snapshot_renderer_failed');
    expect(result.svg).toContain('Renderer error');
  });

  it('aborts the complete snapshot when a hard safety limit is exceeded', () => {
    expect(() =>
      composeSnapshot({
        limits: {
          maxNodes: 1,
          maxDepth: 2,
          maxTextLength: 100,
          maxPathLength: 100,
          maxCoordinate: 1000,
          maxResourceHandles: 1
        },
        items: [
          {
            element: element(),
            status: 'supported',
            contribution: {
              space: 'frame',
              layer: 'content',
              nodes: [
                { kind: 'rect', x: 0, y: 0, width: 10, height: 10 },
                { kind: 'rect', x: 20, y: 0, width: 10, height: 10 }
              ]
            }
          }
        ]
      })
    ).toThrowError(/node count exceeds/);
  });
});
