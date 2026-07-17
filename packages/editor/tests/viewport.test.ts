import { describe, expect, it } from 'vitest';
import { flowViewportToWorld, worldViewportToFlow } from '../src/viewport.js';

describe('editor viewport conversion', () => {
  it('round trips a centered world viewport through React Flow translation', () => {
    const size = { width: 1200, height: 800 };
    const world = { centerX: 240, centerY: -80, zoom: 1.5 };
    const flow = worldViewportToFlow(world, size);
    expect(flow).toEqual({ x: 240, y: 520, zoom: 1.5 });
    expect(flowViewportToWorld(flow, size)).toEqual(world);
  });
});
