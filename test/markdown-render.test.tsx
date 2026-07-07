import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasRecord } from '../src/contracts';
import { CanvasView } from '../src/web/components/CanvasView';
import { MarkdownBlock } from '../src/web/components/MarkdownBlock';

describe('MarkdownBlock', () => {
  it('renders safe markdown features', () => {
    render(<MarkdownBlock markdown={'# Title\n\n- item\n\n| A | B |\n| - | - |\n| 1 | 2 |'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.getByText('item')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('does not render unsafe raw HTML from markdown', () => {
    const { container } = render(
      <MarkdownBlock markdown={'<script>alert(1)</script><img src=x onerror=alert(1) />'} />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });
});

describe('CanvasView asset fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a clean asset placeholder when an Assets-2 image URL fails to load', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_test',
      title: 'Asset fallback',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [
        {
          id: 'asset_1',
          type: 'asset',
          x: 10,
          y: 10,
          width: 200,
          height: 120,
          assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000001' },
          resolvedUrl: 'http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000001/content',
          caption: 'Missing image'
        }
      ]
    };

    render(<CanvasView canvas={canvas} readOnly />);
    fireEvent.error(screen.getByRole('img', { name: 'Missing image' }));

    expect(screen.getByText('asset unavailable')).toBeTruthy();
    expect(screen.getByText('00000000-0000-4000-8000-000000000001')).toBeTruthy();
  });

  it('opens generated image details when an asset card details button is clicked', async () => {
    const assetId = '00000000-0000-4000-8000-000000000001';
    const contextId = '00000000-0000-4000-8000-000000000002';
    const canvas: CanvasRecord = {
      id: 'canvas_details',
      title: 'Asset details',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [
        {
          id: 'asset_1',
          type: 'asset',
          x: 10,
          y: 10,
          width: 200,
          height: 120,
          assetRef: { type: 'asset', project: 'demo', assetId },
          resolvedUrl: `/api/assets/demo/${assetId}/content`,
          caption: 'Generated card'
        }
      ]
    };
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(`/api/assets/demo/${assetId}/details`);
      return new Response(
        JSON.stringify({
          ok: true,
          asset: {
            project: 'demo',
            assetId,
            filename: 'image-1.png',
            contentType: 'image/png',
            width: 1024,
            height: 1536,
            createdAt: '2026-06-13T11:30:52.000Z'
          },
          generation: {
            service: 'RouterImage-2',
            provider: 'openai',
            model: 'gpt-image-2',
            quality: 'low',
            prompt: 'Draw a premium card.',
            contextImages: [
              {
                type: 'asset',
                project: 'demo',
                assetId: contextId,
                resolvedUrl: `/api/assets/demo/${contextId}/content`
              }
            ],
            controls: { style: 'storybook' },
            requestId: 'req_1',
            imageIndex: 1,
            generatedAt: '2026-06-13T11:30:53.000Z'
          },
          cost: {
            currency: 'USD',
            amount: 0.006,
            estimated: true,
            pricingSource: 'pricing-catalog',
            pricingVersion: '2026-06-19'
          },
          warnings: []
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CanvasView canvas={canvas} readOnly />);
    fireEvent.click(screen.getByRole('button', { name: /open asset details for generated card/i }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: /asset details/i })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(assetId)).toBeTruthy();
    expect(screen.getByText('openai / gpt-image-2')).toBeTruthy();
    expect(screen.getByText('low')).toBeTruthy();
    expect(screen.getByText('$0.006 estimated')).toBeTruthy();
    expect(screen.getByText('pricing-catalog / 2026-06-19')).toBeTruthy();
    expect(screen.getByText('1024 × 1536')).toBeTruthy();
    expect(screen.getByText('Draw a premium card.')).toBeTruthy();
    expect(screen.getByText(contextId)).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /asset details/i })).toBeNull());
  });

  it('renders bbox overlay nodes with an optional image and scaled SVG rectangles', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_bbox',
      title: 'Bboxes',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [
        {
          id: 'bbox_1',
          type: 'bboxOverlay',
          x: 10,
          y: 10,
          width: 512,
          height: 768,
          canvasWidth: 1024,
          canvasHeight: 1536,
          imageAssetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000777' },
          imageResolvedUrl: '/api/assets/demo/00000000-0000-4000-8000-000000000777/content',
          caption: 'Character bboxes',
          boxes: [
            {
              id: 'title',
              x: 105,
              y: 960,
              width: 814,
              height: 72,
              label: 'Title',
              color: '#d81b60',
              labelAlign: 'center',
              labelVerticalAlign: 'middle'
            }
          ]
        }
      ]
    };

    const { container } = render(<CanvasView canvas={canvas} readOnly />);

    const image = screen.getByRole('img', { name: 'Character bboxes' }) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('/api/assets/demo/00000000-0000-4000-8000-000000000777/content');
    expect(container.querySelector('.bbox-overlay-svg')).toBeTruthy();
    expect(container.querySelector('rect[data-bbox-id="title"]')).toBeTruthy();
    const titleLabel = screen.getByText('Title');
    expect(titleLabel.getAttribute('text-anchor')).toBe('middle');
    expect(titleLabel.getAttribute('dominant-baseline')).toBe('middle');
  });

  it('renders path overlay nodes with scaled SVG paths and a visible path legend', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_path',
      title: 'Paths',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [
        {
          id: 'path_1',
          type: 'pathOverlay',
          x: 10,
          y: 10,
          width: 512,
          height: 768,
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
      ]
    };

    const { container } = render(<CanvasView canvas={canvas} readOnly />);

    expect(container.querySelector('.path-overlay-svg')).toBeTruthy();
    const path = container.querySelector('path[data-path-id="name_panel"]');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('d')).toContain('Q 320 2520');
    expect(screen.getByText('CARD NAME')).toBeTruthy();
  });

  it('renders GLB viewer nodes with a model-viewer pointing at the resolved asset URL', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_glb',
      title: 'GLB viewer',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [
        {
          id: 'glb_1',
          type: 'glbViewer',
          x: 10,
          y: 10,
          width: 320,
          height: 240,
          assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000123' },
          resolvedUrl: 'http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000123/content',
          caption: 'Robot.glb',
          cameraControls: true
        }
      ]
    };

    const { container } = render(<CanvasView canvas={canvas} readOnly />);
    const viewer = container.querySelector('model-viewer');

    expect(viewer).toBeTruthy();
    expect(viewer?.getAttribute('src')).toBe(
      'http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000123/content'
    );
    expect(viewer?.getAttribute('camera-controls')).toBe('');
    expect(viewer?.getAttribute('interaction-prompt')).toBe('auto');
    expect(viewer?.getAttribute('interaction-prompt-style')).toBe('basic');
    expect(screen.getByText('Robot.glb')).toBeTruthy();
    expect(screen.getByText('Drag to orbit · scroll to zoom')).toBeTruthy();
  });

  it('uses viewport wheel gestures for canvas zoom instead of vertical panning', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_wheel_zoom',
      title: 'Wheel zoom',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: []
    };

    const { container } = render(<CanvasView canvas={canvas} readOnly />);
    const viewport = container.querySelector('.canvas-viewport') as Element;

    fireEvent.wheel(viewport, { deltaY: 120, deltaX: 0, clientX: 0, clientY: 0 });

    expect(screen.getByLabelText('Viewport center').textContent).toContain('center 0, 0 · zoom 89%');
  });

  it('lets editable users drag nodes to new canvas coordinates without panning the viewport', async () => {
    const canvas: CanvasRecord = {
      id: 'canvas_move_nodes',
      title: 'Move nodes',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [{ id: 'note_1', type: 'text', x: 10, y: 20, width: 160, height: 80, text: 'Move me' }]
    };
    const onElementMove = vi.fn(async () => undefined);

    render(<CanvasView canvas={canvas} onElementMove={onElementMove} />);
    const card = screen.getByText('Move me');

    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 7 });
    fireEvent.pointerMove(card, { clientX: 150, clientY: 125, pointerId: 7 });
    fireEvent.pointerUp(card, { clientX: 150, clientY: 125, pointerId: 7 });

    expect(screen.getByLabelText('Viewport center').textContent).toContain('center 0, 0 · zoom 100%');
    await waitFor(() => expect(onElementMove).toHaveBeenCalledWith('note_1', 60, 45));
    expect(screen.getByRole('button', { name: 'Move node note_1' })).toBeTruthy();
  });

  it('does not expose node-moving controls on read-only canvases', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_move_readonly',
      title: 'Move read-only',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [{ id: 'note_1', type: 'text', x: 10, y: 20, width: 160, height: 80, text: 'Cannot move me' }]
    };
    const onElementMove = vi.fn();

    render(<CanvasView canvas={canvas} readOnly onElementMove={onElementMove} />);

    expect(screen.queryByRole('button', { name: 'Move node note_1' })).toBeNull();
  });

  it('lets pointer and wheel gestures inside GLB viewers control the 3D camera instead of the canvas', () => {
    const canvas: CanvasRecord = {
      id: 'canvas_glb_interactive',
      title: 'GLB viewer',
      createdBy: 'agent',
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [
        {
          id: 'glb_1',
          type: 'glbViewer',
          x: 10,
          y: 10,
          width: 320,
          height: 240,
          assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000123' },
          resolvedUrl: '/api/assets/demo/00000000-0000-4000-8000-000000000123/content',
          caption: 'Robot.glb',
          cameraControls: true
        }
      ]
    };

    const { container } = render(<CanvasView canvas={canvas} readOnly />);
    const viewer = container.querySelector('model-viewer') as Element;
    const viewport = container.querySelector('.canvas-viewport') as Element;

    fireEvent.pointerDown(viewer, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    expect(viewport.classList.contains('is-dragging')).toBe(false);

    fireEvent.wheel(viewer, { deltaY: 120 });
    expect(screen.getByLabelText('Viewport center').textContent).toContain('center 0, 0 · zoom 100%');
  });
});
