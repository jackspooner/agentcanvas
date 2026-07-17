import { describe, expect, it } from 'vitest';
import { changedFrames } from '../src/AgentCanvasEditor.js';
import { elementFrame, projectElement } from '../src/projection.js';

describe('editor element projection', () => {
  it('uses stable default dimensions and preserves frame ownership', () => {
    const element = { id: 'card', x: 10, y: 20, locked: true };
    expect(elementFrame(element)).toEqual({ x: 10, y: 20, width: 240, height: 120 });
    expect(projectElement(element)).toMatchObject({
      id: 'card',
      position: { x: 10, y: 20 },
      width: 240,
      height: 120,
      draggable: false
    });
  });

  it('derives canonical frame changes from a completed gesture', () => {
    const node = projectElement({ id: 'card', x: 10, y: 20, width: 100, height: 80 });
    const before = new Map([['card', { x: 10, y: 20, width: 100, height: 80 }]]);
    expect(changedFrames(before, [{ ...node, position: { x: 35, y: 45 } }])).toEqual([
      {
        elementId: 'card',
        before: { x: 10, y: 20, width: 100, height: 80 },
        after: { x: 35, y: 45, width: 100, height: 80 }
      }
    ]);
  });
});
