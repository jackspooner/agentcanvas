import { describe, expect, it } from 'vitest';
import type { CanvasRecord } from '../src/contracts';
import { coerceScreenshotOptions, renderCanvasScreenshotSvg, screenshotDataUrl } from '../src/screenshot';

function canvas(elements: CanvasRecord['elements']): CanvasRecord {
  return {
    id: 'canvas_test',
    title: 'Screenshot Test Canvas',
    createdBy: 'agent',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    width: 1600,
    height: 1000,
    elements,
    revision: 1
  };
}

describe('canvas screenshot rendering', () => {
  it('coerces invalid screenshot options to safe defaults and clamps zoom', () => {
    expect(
      coerceScreenshotOptions({
        width: Number.NaN,
        height: Infinity,
        centerX: 42,
        centerY: -18,
        zoom: 100,
        fullCanvas: true,
        overlayNodeIds: true,
        padding: 24
      })
    ).toEqual({
      width: 1280,
      height: 720,
      centerX: 42,
      centerY: -18,
      zoom: 8,
      fullCanvas: true,
      overlayNodeIds: true,
      padding: 24
    });

    expect(coerceScreenshotOptions({ zoom: 0 })).toMatchObject({ zoom: 0.05 });
  });

  it('renders the full canvas bounds around non-connector nodes and overlays node ids when requested', () => {
    const rendered = renderCanvasScreenshotSvg(
      canvas([
        {
          id: 'left_card',
          type: 'markdown',
          x: -100,
          y: 25,
          width: 200,
          height: 120,
          markdown: '## Hello <Agent>\n\n- safe & visible'
        },
        { id: 'right_text', type: 'text', x: 400, y: 300, width: 160, height: 80, text: 'Status: ok' },
        {
          id: 'arrow_1',
          type: 'arrow',
          x: 0,
          y: 0,
          from: { elementId: 'left_card', anchor: 'right' },
          to: { elementId: 'right_text', anchor: 'left' },
          stroke: '#f00'
        }
      ]),
      { fullCanvas: true, overlayNodeIds: true, padding: 20, width: 900, height: 600 }
    );

    expect(rendered.viewBox).toEqual({ x: -120, y: 5, width: 700, height: 395 });
    expect(rendered.overlayNodeIds).toBe(true);
    expect(rendered.svg).toContain('data-node-id="left_card"');
    expect(rendered.svg).toContain('data-overlay-for="left_card"');
    expect(rendered.svg).toContain('Hello &lt;Agent&gt;');
    expect(rendered.svg).toContain('safe &amp; visible');
    expect(rendered.svg).toContain('marker-end="url(#arrowhead)"');
  });

  it('renders viewport screenshots from center and zoom and returns a decodable SVG data URL', () => {
    const rendered = renderCanvasScreenshotSvg(
      canvas([{ id: 'note_1', type: 'text', x: 90, y: 120, width: 180, height: 90, text: 'Viewport note' }]),
      { width: 1000, height: 500, centerX: 250, centerY: 100, zoom: 2 }
    );

    expect(rendered.viewBox).toEqual({ x: 0, y: -25, width: 500, height: 250 });
    const dataUrl = screenshotDataUrl(rendered.svg);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(dataUrl.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf-8');
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('Viewport note');
  });

  it('renders path overlay geometry in screenshots', () => {
    const rendered = renderCanvasScreenshotSvg(
      canvas([
        {
          id: 'path_1',
          type: 'pathOverlay',
          x: 40,
          y: 60,
          width: 420,
          height: 220,
          canvasWidth: 2932,
          canvasHeight: 4096,
          caption: 'Card name path',
          paths: [
            {
              id: 'name_panel',
              d: 'M 260 2700 Q 320 2520 520 2520 L 2412 2520 Q 2612 2520 2672 2700 Z',
              label: 'CARD NAME',
              color: '#e11d48',
              fill: '#e11d4822',
              strokeWidth: 10
            }
          ]
        }
      ]),
      { fullCanvas: true, width: 900, height: 600 }
    );

    expect(rendered.svg).toContain('data-node-id="path_1"');
    expect(rendered.svg).toContain('data-path-id="name_panel"');
    expect(rendered.svg).toContain('CARD NAME');
    expect(rendered.svg).toContain('Card name path');
  });
});
