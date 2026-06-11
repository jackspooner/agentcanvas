import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    const { container } = render(<MarkdownBlock markdown={'<script>alert(1)</script><img src=x onerror=alert(1) />'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });
});

describe('CanvasView asset fallback', () => {
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
      elements: [{
        id: 'asset_1',
        type: 'asset',
        x: 10,
        y: 10,
        width: 200,
        height: 120,
        assetRef: { type: 'asset', project: 'demo', assetId: '00000000-0000-4000-8000-000000000001' },
        resolvedUrl: 'http://127.0.0.1:23000/projects/demo/assets/00000000-0000-4000-8000-000000000001/content',
        caption: 'Missing image'
      }]
    };

    render(<CanvasView canvas={canvas} readOnly />);
    fireEvent.error(screen.getByRole('img', { name: 'Missing image' }));

    expect(screen.getByText('asset unavailable')).toBeTruthy();
    expect(screen.getByText('00000000-0000-4000-8000-000000000001')).toBeTruthy();
  });
});
