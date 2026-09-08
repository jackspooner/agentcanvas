import type { CanvasElement, ElementTypeDescriptor } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { inspectCanvas, inspectCanvasElements } from '../src/plugin-runtime/inspection.js';
import type { FrozenPluginRegistry } from '../src/plugin-runtime/registry.js';

const descriptor = {} as ElementTypeDescriptor;
const registry = {
  getElementType: () => descriptor
} as unknown as FrozenPluginRegistry;

function element(id: string, x: number, y: number, metadata?: Record<string, boolean>): CanvasElement {
  return {
    id,
    type: 'fixture.cards/card',
    schemaVersion: 1,
    x,
    y,
    width: 100,
    height: 100,
    data: {},
    ...(metadata ? { metadata } : {})
  };
}

describe('plugin-owned canvas inspection', () => {
  it('bounds crowded-canvas warnings, reports truncation honestly, and supports off or all', () => {
    const canvas = { id: 'crowded', elements: Array.from({ length: 500 }, (_, i) => element(`card_${i}`, 0, 0)) };
    const limited = inspectCanvas(canvas, registry);
    expect(limited.diagnostics).toHaveLength(101);
    expect(limited.summary).toEqual({ errorCount: 0, warningCount: 100, infoCount: 1 });
    expect(limited.diagnostics.at(-1)?.code).toBe('overlap_diagnostics_truncated');
    expect(JSON.stringify(limited).length).toBeLessThan(30_000);
    const three = { ...canvas, elements: canvas.elements.slice(0, 3) };
    expect(inspectCanvasElements(three, registry, { overlapMode: 'bounded', maxOverlapWarnings: 3 })).toHaveLength(3);
    expect(inspectCanvasElements(three, registry, { overlapMode: 'bounded', maxOverlapWarnings: 1 })).toHaveLength(2);
    expect(inspectCanvasElements(three, registry, { overlapMode: 'all', maxOverlapWarnings: 1 })).toHaveLength(3);
    const unavailable = { getElementType: () => undefined } as unknown as FrozenPluginRegistry;
    expect(
      inspectCanvasElements(three, unavailable, { overlapMode: 'off', maxOverlapWarnings: 1 }).map((item) => item.code)
    ).toEqual(['plugin_unavailable', 'plugin_unavailable', 'plugin_unavailable']);
  });
  it('reports intersecting frames and permits explicit layering intent', () => {
    const overlapping = inspectCanvasElements(
      { id: 'canvas_1', elements: [element('first', 0, 0), element('second', 80, 70)] },
      registry
    );
    expect(overlapping).toEqual([
      expect.objectContaining({
        code: 'element_frames_overlap',
        elementId: 'second',
        message: expect.stringContaining('20×30 world pixels')
      })
    ]);

    const intentional = inspectCanvasElements(
      {
        id: 'canvas_1',
        elements: [element('first', 0, 0), element('second', 80, 70, { allowOverlap: true })]
      },
      registry
    );
    expect(intentional).toEqual([]);
  });

  it('summarizes diagnostic severities for mutation responses', () => {
    expect(
      inspectCanvas({ id: 'canvas_1', elements: [element('first', 0, 0), element('second', 80, 70)] }, registry)
    ).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'element_frames_overlap' })],
      summary: { errorCount: 0, warningCount: 1, infoCount: 0 }
    });
  });
});
