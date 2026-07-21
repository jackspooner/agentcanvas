import type { CanvasElement, ElementTypeDescriptor } from '@agentcanvas/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { inspectCanvasElements } from '../src/plugin-runtime/inspection.js';
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
});
