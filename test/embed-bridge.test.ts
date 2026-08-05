import { describe, expect, it } from 'vitest';
import {
  AGENTCANVAS_EMBED_BRIDGE_VERSION,
  embedTokenFromPath,
  isAgentCanvasHostMessage
} from '../src/web/embed-bridge';

describe('embed bridge contract', () => {
  it('accepts only the versioned host navigation and refresh messages', () => {
    expect(
      isAgentCanvasHostMessage({
        source: 'agentcanvas.host',
        version: AGENTCANVAS_EMBED_BRIDGE_VERSION,
        type: 'navigate',
        canvasId: 'canvas_1'
      })
    ).toBe(true);
    expect(
      isAgentCanvasHostMessage({
        source: 'agentcanvas.host',
        version: AGENTCANVAS_EMBED_BRIDGE_VERSION,
        type: 'refresh'
      })
    ).toBe(true);
    expect(isAgentCanvasHostMessage({ source: 'agentcanvas.host', version: 2, type: 'refresh' })).toBe(false);
    expect(isAgentCanvasHostMessage({ source: 'attacker', version: 1, type: 'navigate' })).toBe(false);
  });

  it('extracts only a single embed path token', () => {
    expect(embedTokenFromPath('/embed/embed_123')).toBe('embed_123');
    expect(embedTokenFromPath('/embed/embed%5F123')).toBe('embed_123');
    expect(embedTokenFromPath('/embed/embed_123/extra')).toBeNull();
    expect(embedTokenFromPath('/canvases/canvas_1')).toBeNull();
  });
});
