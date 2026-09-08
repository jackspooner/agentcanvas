import type { CanvasElement } from '@agentcanvas/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { collectSnapshotItems, composeSnapshot } from '../src/snapshot-runtime/index.js';

function element(id: string, overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    type: 'acme.cards/hello',
    schemaVersion: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    data: {},
    ...overrides
  };
}

describe('snapshot compositor', () => {
  it('applies frame translation, rotation, opacity, clipping, layer and z ordering', () => {
    const result = composeSnapshot({
      padding: 0,
      items: [
        {
          element: element('top', { x: 50, y: 40, rotation: 90, opacity: 0.5, zIndex: 2 }),
          status: 'supported',
          contribution: {
            space: 'frame',
            layer: 'content',
            nodes: [{ kind: 'rect', x: 0, y: 0, width: 100, height: 60, fill: '#00ff00' }]
          }
        },
        {
          element: element('under', { zIndex: 50 }),
          status: 'supported',
          contribution: {
            space: 'world',
            layer: 'underlay',
            nodes: [{ kind: 'line', x1: -20, y1: -10, x2: 220, y2: 100, stroke: '#000000' }]
          }
        }
      ]
    });
    expect(result.svg.indexOf('data-element-id="under"')).toBeLessThan(result.svg.indexOf('data-element-id="top"'));
    expect(result.svg).toMatch(
      /data-element-id="top" transform="matrix\([^)]*\)" opacity="0.5" clip-path="url\(#agentcanvas-clip-/
    );
    expect(result.viewBox.x).toBeLessThanOrEqual(-20);
    expect(result.viewBox.width).toBeGreaterThanOrEqual(240);
  });

  it('includes world connector geometry outside element frames in full-canvas bounds', () => {
    const result = composeSnapshot({
      padding: 10,
      items: [
        {
          element: element('connector'),
          status: 'supported',
          contribution: {
            space: 'world',
            layer: 'overlay',
            nodes: [{ kind: 'line', x1: -500, y1: -250, x2: 900, y2: 700, stroke: '#111111', strokeWidth: 4 }]
          }
        }
      ]
    });
    expect(result.viewBox.x).toBe(-512);
    expect(result.viewBox.y).toBe(-262);
    expect(result.viewBox.width).toBe(1424);
    expect(result.viewBox.height).toBe(974);
  });

  it.each(['missing', 'unsupported', 'failed'] as const)('renders a diagnostic card for %s renderers', (status) => {
    const result = composeSnapshot({ items: [{ element: element(status), status }] });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.svg).toContain(
      status === 'missing' ? 'Plugin unavailable' : status === 'unsupported' ? 'Snapshot unavailable' : 'Renderer error'
    );
  });
});

describe('snapshot renderer collection', () => {
  it.each([
    [undefined, undefined, 2000],
    [undefined, 5000, 5000],
    [10, 5000, 10]
  ] as const)('prioritizes explicit deadline %s over descriptor %s with a bounded default', async (rendererTimeoutMs, snapshotTimeoutMs, deadline) => {
    vi.useFakeTimers();
    try {
      const settled = vi.fn();
      const pending = collectSnapshotItems({
        canvasId: 'canvas',
        elements: [element('slow')],
        rendererTimeoutMs,
        registry: {
          getElementType: () => ({
            snapshot: 'supported',
            snapshotTimeoutMs,
            renderSnapshot: () => new Promise(() => {})
          })
        }
      }).then(settled);
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toHaveBeenCalledWith([
        expect.objectContaining({ diagnostic: expect.objectContaining({ code: 'snapshot_renderer_timeout' }) })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, 1.5, 30001, Number.NaN])('rejects invalid descriptor deadline %s', async (snapshotTimeoutMs) => {
    await expect(
      collectSnapshotItems({
        canvasId: 'canvas',
        elements: [element('invalid')],
        registry: { getElementType: () => ({ snapshot: 'supported', snapshotTimeoutMs }) }
      })
    ).rejects.toThrow('snapshotTimeoutMs');
  });
  it('uses registry descriptors without a type switch and passes runtime projections', async () => {
    const renderSnapshot = vi.fn((_element, context) => ({
      space: 'frame' as const,
      layer: 'content' as const,
      nodes: [{ kind: 'text' as const, x: 0, y: 12, text: String(context.runtime?.label) }]
    }));
    const items = await collectSnapshotItems({
      canvasId: 'canvas-1',
      elements: [element('known'), element('unknown', { type: 'missing.plugin/card' })],
      elementRuntime: { known: { label: 'runtime only' } },
      registry: {
        getElementType: (type) => (type === 'acme.cards/hello' ? { snapshot: 'supported', renderSnapshot } : undefined)
      }
    });
    expect(items.map((item) => item.status)).toEqual(['supported', 'missing']);
    expect(renderSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'known' }),
      expect.objectContaining({ canvasId: 'canvas-1', runtime: { label: 'runtime only' } })
    );
  });

  it('aborts and diagnoses a renderer that exceeds its deadline without exposing its error', async () => {
    vi.useFakeTimers();
    try {
      let rendererSignal: AbortSignal | undefined;
      const pending = collectSnapshotItems({
        canvasId: 'canvas-1',
        elements: [element('slow')],
        rendererTimeoutMs: 10,
        registry: {
          getElementType: () => ({
            snapshot: 'supported',
            renderSnapshot: (_element, context) => {
              rendererSignal = context.signal;
              return new Promise(() => {});
            }
          })
        }
      });
      await vi.advanceTimersByTimeAsync(10);
      const items = await pending;
      expect(rendererSignal?.aborted).toBe(true);
      expect(items[0]).toMatchObject({
        status: 'failed',
        diagnostic: { code: 'snapshot_renderer_timeout', retryable: true }
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
