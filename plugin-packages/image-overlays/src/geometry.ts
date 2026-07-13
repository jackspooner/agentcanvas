import type { BBox } from './contracts.js';

export const OVERLAY_ACCENTS = ['#2563eb', '#9333ea', '#0891b2', '#db2777', '#ea580c', '#16a34a'] as const;

export function overlayAccent(index: number): string {
  return OVERLAY_ACCENTS[index % OVERLAY_ACCENTS.length] as string;
}

export interface ScaledBBox extends BBox {
  scaledX: number;
  scaledY: number;
  scaledWidth: number;
  scaledHeight: number;
  colorValue: string;
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'middle' | 'end';
}

export function scaleBBox(
  box: BBox,
  index: number,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): ScaledBBox {
  const sx = targetWidth / sourceWidth;
  const sy = targetHeight / sourceHeight;
  const x = box.x * sx;
  const y = box.y * sy;
  const width = box.width * sx;
  const height = box.height * sy;
  const padding = box.labelPadding ?? 8;
  const align = box.labelAlign ?? 'left';
  const vertical = box.labelVerticalAlign ?? 'top';
  return {
    ...box,
    scaledX: x,
    scaledY: y,
    scaledWidth: width,
    scaledHeight: height,
    colorValue: box.color ?? overlayAccent(index),
    textAnchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start',
    labelX: align === 'center' ? x + width / 2 : align === 'right' ? x + width - padding * sx : x + padding * sx,
    labelY:
      vertical === 'middle' ? y + height / 2 : vertical === 'bottom' ? y + height - padding * sy : y + padding * sy
  };
}
