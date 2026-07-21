import { describe, expect, it } from 'vitest';
import { arrowHead, connectorRoute, resolveConnectorEndpoints, routeMidpoint } from '../src/geometry.js';

describe('primitive connector geometry', () => {
  it('resolves element anchors before falling back to free coordinates', () => {
    const geometry = resolveConnectorEndpoints(
      { elementId: 'left', x: 1, y: 2, anchor: 'right' },
      { elementId: 'right', anchor: 'left' },
      {
        resolveAnchor(elementId, anchor) {
          if (elementId === 'left' && anchor === 'right') return { x: 120, y: 40 };
          if (elementId === 'right' && anchor === 'left') return { x: 300, y: 60 };
          return null;
        }
      }
    );
    expect(geometry).toEqual({ from: { x: 120, y: 40 }, to: { x: 300, y: 60 }, missingElementIds: [] });
  });

  it('reports unresolved anchor ids and creates a finite arrow head', () => {
    const geometry = resolveConnectorEndpoints({ elementId: 'missing', x: 10, y: 20 }, { x: 50, y: 20 });
    expect(geometry.missingElementIds).toEqual(['missing']);
    expect(
      arrowHead(geometry.from, geometry.to)
        .flatMap((point) => [point.x, point.y])
        .every(Number.isFinite)
    ).toBe(true);
  });

  it('routes same-side anchors outside the direct node column', () => {
    const route = connectorRoute(
      { elementId: 'bottom', anchor: 'left' },
      { elementId: 'top', anchor: 'left' },
      { from: { x: -140, y: 435 }, to: { x: -140, y: -115 } }
    );
    expect(route).toEqual([
      { x: -140, y: 435 },
      { x: -415, y: 435 },
      { x: -415, y: -115 },
      { x: -140, y: -115 }
    ]);
    expect(routeMidpoint(route)).toEqual({ x: -415, y: 160 });
  });
});
