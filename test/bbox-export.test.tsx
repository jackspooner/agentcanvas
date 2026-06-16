import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasRecord } from '../src/contracts';
import { CanvasView } from '../src/web/components/CanvasView';

const zipFile = vi.fn();
const zipFolder = vi.fn(() => ({ file: zipFile }));
const zipGenerateAsync = vi.fn(async () => new Blob(['zip-bytes'], { type: 'application/zip' }));
const zipFolderNames: string[] = [];

vi.mock('jszip', () => ({
  default: class FakeZip {
    folder(name: string) {
      zipFolderNames.push(name);
      return zipFolder();
    }

    generateAsync() {
      return zipGenerateAsync();
    }
  }
}));

describe('BBox overlay exports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    zipFile.mockClear();
    zipFolder.mockClear();
    zipGenerateAsync.mockClear();
    zipFolderNames.splice(0, zipFolderNames.length);
  });

  it('exports every bbox as a binary mask PNG inside a zip download', async () => {
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      fillRect
    } as unknown as CanvasRenderingContext2D));
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(callback) {
      callback(new Blob(['mask-png'], { type: 'image/png' }));
    });

    const createObjectURL = vi.fn(() => 'blob:mask-zip');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const canvas: CanvasRecord = {
      id: 'canvas_bbox_export',
      title: 'BBox export',
      createdBy: 'agent',
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
      width: 800,
      height: 600,
      revision: 1,
      elements: [{
        id: 'bbox_1',
        type: 'bboxOverlay',
        x: 10,
        y: 10,
        width: 512,
        height: 768,
        canvasWidth: 1024,
        canvasHeight: 1536,
        caption: 'Character bboxes',
        boxes: [
          { id: 'title', x: 105, y: 960, width: 814, height: 72, label: 'Title' },
          { id: 'stats', x: 112, y: 1060, width: 595, height: 48, label: 'Stats' }
        ]
      }]
    };

    render(<CanvasView canvas={canvas} readOnly />);
    fireEvent.click(screen.getByRole('button', { name: /export bbox masks as zip/i }));

    await waitFor(() => expect(zipGenerateAsync).toHaveBeenCalledTimes(1));
    expect(zipFolderNames).toEqual(['bbox_1-1024x1536-masks']);
    expect(zipFolder).toHaveBeenCalledTimes(1);
    expect(zipFile).toHaveBeenNthCalledWith(1, '01-title.png', expect.any(Blob));
    expect(zipFile).toHaveBeenNthCalledWith(2, '02-stats.png', expect.any(Blob));
    expect(fillRect.mock.calls).toEqual([
      [0, 0, 1024, 1536],
      [105, 960, 814, 72],
      [0, 0, 1024, 1536],
      [112, 1060, 595, 48]
    ]);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mask-zip');
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});
