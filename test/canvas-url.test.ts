import { describe, expect, it } from 'vitest';
import { canvasPageUrl, canvasShareUrl } from '../src/canvas-url.js';

describe('canvas browser URLs', () => {
  it('preserves a configured base path and safely encodes canvas and share identifiers', () => {
    expect(canvasPageUrl('https://canvas.example.test/agentcanvas/', 'canvas alpha/one')).toBe(
      'https://canvas.example.test/agentcanvas/canvases/canvas%20alpha%2Fone'
    );
    expect(canvasShareUrl('https://canvas.example.test/agentcanvas/', 'share token/one')).toBe(
      'https://canvas.example.test/agentcanvas/c/share%20token%2Fone'
    );
  });
});
