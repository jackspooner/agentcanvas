import { describe, expect, it } from 'vitest';
import { ensureElementCap, normalizeCanvasBounds, normalizeViewportInput } from '../src/index.js';

describe('AgentCanvas document kernel validation', () => {
  it('normalizes canvas bounds without knowing element types', () => {
    expect(normalizeCanvasBounds(undefined)).toEqual({ mode: 'unlimited' });
    expect(normalizeCanvasBounds({ mode: 'fixed', width: 1200.4, height: 800.2 })).toEqual({
      mode: 'fixed',
      width: 1200,
      height: 800
    });
  });

  it('retains the bounded viewport contract', () => {
    expect(normalizeViewportInput({ centerX: -10, centerY: 20, zoom: 2 })).toMatchObject({
      centerX: -10,
      centerY: 20,
      zoom: 2,
      source: 'user'
    });
    expect(() => normalizeViewportInput({ zoom: 100 })).toThrow(/zoom/);
  });

  it('applies only the generic document element-count limit', () => {
    expect(() => ensureElementCap([])).not.toThrow();
    expect(() => ensureElementCap(Array.from({ length: 2001 }) as never)).toThrow(/2000/);
  });
});
