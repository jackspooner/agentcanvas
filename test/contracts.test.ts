import { describe, expect, it } from 'vitest';
import { normalizeCanvasElement, resolveAssetContentUrl, validateAssetRef } from '../src/validation';

describe('canvas contracts and validation', () => {
  it('accepts markdown elements', () => {
    const element = normalizeCanvasElement({
      id: 'notes',
      type: 'markdown',
      x: 10,
      y: 20,
      width: 320,
      height: 180,
      markdown: '# Notes\n\n- item'
    });
    expect(element.type).toBe('markdown');
    if (element.type !== 'markdown') throw new Error('expected markdown element');
    expect(element.markdown).toContain('Notes');
  });

  it('rejects overlong markdown elements', () => {
    expect(() => normalizeCanvasElement({
      id: 'too-big',
      type: 'markdown',
      x: 0,
      y: 0,
      markdown: 'x'.repeat(20001)
    })).toThrow(/markdown/i);
  });

  it('rejects local paths as asset refs', () => {
    expect(() => validateAssetRef('C:/tmp/image.png')).toThrow(/asset ref/i);
  });

  it('resolves Assets-2 content URLs server-side', () => {
    const url = resolveAssetContentUrl({
      type: 'asset',
      project: 'demo',
      assetId: '00000000-0000-4000-8000-000000000000',
      assetBaseUrl: 'http://127.0.0.1:23000'
    });
    expect(url).toBe('http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000000/content');
  });

  it('accepts GLB viewer elements backed by a single Assets-2 asset ref', () => {
    const element = normalizeCanvasElement({
      id: 'glb_1',
      type: 'glbViewer',
      x: 25,
      y: 35,
      width: 320,
      height: 240,
      assetRef: {
        type: 'asset',
        project: 'demo',
        assetId: '00000000-0000-4000-8000-000000000123'
      },
      caption: 'Chair.glb',
      cameraControls: true,
      autoRotate: false
    });

    expect(element.type).toBe('glbViewer');
    if (element.type !== 'glbViewer') throw new Error('expected glbViewer element');
    expect(element.assetRef.assetId).toBe('00000000-0000-4000-8000-000000000123');
    expect(element.caption).toBe('Chair.glb');
    expect(element.cameraControls).toBe(true);
    expect(element.autoRotate).toBe(false);
  });

  it('accepts bbox overlay elements over either an image asset or a plain coordinate canvas', () => {
    const element = normalizeCanvasElement({
      id: 'character_bboxes',
      type: 'bboxOverlay',
      x: 40,
      y: 80,
      width: 512,
      height: 768,
      canvasWidth: 1024,
      canvasHeight: 1536,
      imageAssetRef: {
        type: 'asset',
        project: 'kindeck',
        assetId: '00000000-0000-4000-8000-000000000456'
      },
      caption: 'Character bbox contract',
      showLabels: true,
      boxes: [{ id: 'title', x: 105, y: 960, width: 814, height: 72, label: 'Title', color: '#d81b60', labelAlign: 'center', labelVerticalAlign: 'middle', labelPadding: 12 }]
    });

    expect(element.type).toBe('bboxOverlay');
    if (element.type !== 'bboxOverlay') throw new Error('expected bboxOverlay element');
    expect(element.canvasWidth).toBe(1024);
    expect(element.canvasHeight).toBe(1536);
    expect(element.imageAssetRef?.assetId).toBe('00000000-0000-4000-8000-000000000456');
    expect(element.boxes).toBeDefined();
    expect(element.boxes?.[0]).toMatchObject({ id: 'title', x: 105, y: 960, width: 814, height: 72, labelAlign: 'center', labelVerticalAlign: 'middle', labelPadding: 12 });
    expect(element.showLabels).toBe(true);
  });

  it('accepts bbox overlay elements that read their layout from an Assets-2 JSON asset', () => {
    const element = normalizeCanvasElement({
      id: 'character_bboxes_asset_backed',
      type: 'bboxOverlay',
      x: 40,
      y: 80,
      width: 512,
      height: 768,
      layoutAssetRef: {
        type: 'asset',
        project: 'kindeck',
        assetId: '00000000-0000-4000-8000-000000000654'
      },
      caption: 'Character bbox contract',
      showLabels: true
    });

    expect(element.type).toBe('bboxOverlay');
    if (element.type !== 'bboxOverlay') throw new Error('expected bboxOverlay element');
    expect(element.layoutAssetRef?.assetId).toBe('00000000-0000-4000-8000-000000000654');
    expect(element.canvasWidth).toBeUndefined();
    expect(element.canvasHeight).toBeUndefined();
    expect(element.boxes).toBeUndefined();
  });

  it('accepts path overlay elements with SVG path data in a fixed internal coordinate space', () => {
    const element = normalizeCanvasElement({
      id: 'card_name_shape',
      type: 'pathOverlay',
      x: 40,
      y: 80,
      width: 512,
      height: 768,
      canvasWidth: 2932,
      canvasHeight: 4096,
      caption: 'Card name path overlay',
      background: '#fafaf9',
      paths: [{
        id: 'name_panel',
        d: 'M 260 2700 Q 320 2520 520 2520 L 1200 2520 Q 1466 2460 1732 2520 L 2412 2520 Q 2612 2520 2672 2700 Z',
        label: 'CARD NAME',
        color: '#e11d48',
        fill: '#e11d4822',
        strokeWidth: 10
      }]
    });

    expect(element.type).toBe('pathOverlay');
    if (element.type !== 'pathOverlay') throw new Error('expected pathOverlay element');
    expect(element.canvasWidth).toBe(2932);
    expect(element.canvasHeight).toBe(4096);
    expect(element.paths[0]).toMatchObject({
      id: 'name_panel',
      label: 'CARD NAME',
      color: '#e11d48',
      fill: '#e11d4822',
      strokeWidth: 10
    });
  });
});
