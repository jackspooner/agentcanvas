import type { CanvasElement, CanvasRecord } from './contracts.js';

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasElementOverlapDetail {
  elementId: string;
  overlapPercent: number;
  intersectionArea: number;
  bounds: ElementBounds;
}

export interface CanvasElementOverlapWarning {
  code: 'element_overlap';
  elementId: string;
  message: string;
  overlapPercent: number;
  overlapArea: number;
  bounds: ElementBounds;
  overlaps: CanvasElementOverlapDetail[];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function elementWidth(el: CanvasElement): number {
  return finiteNumber(el.width, el.type === 'table' ? 520 : 240);
}

export function elementHeight(el: CanvasElement): number {
  if (typeof el.height === 'number' && Number.isFinite(el.height)) return el.height;
  if (el.type === 'table') return 220;
  if (el.type === 'text') return 100;
  return 160;
}

export function elementBounds(el: CanvasElement): ElementBounds | null {
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'group') return null;
  const width = elementWidth(el);
  const height = elementHeight(el);
  if (width <= 0 || height <= 0) return null;
  return { x: el.x, y: el.y, width, height };
}

function intersection(a: ElementBounds, b: ElementBounds): ElementBounds | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function area(rect: ElementBounds): number {
  return rect.width * rect.height;
}

function unionArea(rects: ElementBounds[]): number {
  if (rects.length === 0) return 0;
  const xs = Array.from(new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.width]))).sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x1 = xs[i];
    const x2 = xs[i + 1];
    const slabWidth = x2 - x1;
    if (slabWidth <= 0) continue;
    const intervals = rects
      .filter((rect) => rect.x < x2 && rect.x + rect.width > x1)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((a, b) => a[0] - b[0]);
    if (intervals.length === 0) continue;
    let coveredY = 0;
    let [start, end] = intervals[0];
    for (const [nextStart, nextEnd] of intervals.slice(1)) {
      if (nextStart <= end) {
        end = Math.max(end, nextEnd);
      } else {
        coveredY += end - start;
        start = nextStart;
        end = nextEnd;
      }
    }
    coveredY += end - start;
    total += slabWidth * coveredY;
  }
  return total;
}

export function changedElementIdsFromOperations(operations: unknown): string[] {
  if (!Array.isArray(operations)) return [];
  const ids: string[] = [];
  for (const op of operations) {
    if (!op || typeof op !== 'object') continue;
    const record = op as Record<string, unknown>;
    if (record.op === 'upsertElement' && record.element && typeof record.element === 'object') {
      const id = (record.element as Record<string, unknown>).id;
      if (typeof id === 'string') ids.push(id);
    }
    if (record.op === 'patchElement' && typeof record.elementId === 'string') ids.push(record.elementId);
  }
  return Array.from(new Set(ids));
}

export function computeOverlapWarnings(canvas: CanvasRecord, changedElementIds: string[]): CanvasElementOverlapWarning[] {
  if (changedElementIds.length === 0 || canvas.elements.length < 2) return [];
  const elementsById = new Map(canvas.elements.map((el) => [el.id, el]));
  const warnings: CanvasElementOverlapWarning[] = [];
  for (const elementId of changedElementIds) {
    const element = elementsById.get(elementId);
    if (!element) continue;
    const targetBounds = elementBounds(element);
    if (!targetBounds) continue;
    const targetArea = area(targetBounds);
    const overlaps: CanvasElementOverlapDetail[] = [];
    const intersections: ElementBounds[] = [];
    for (const other of canvas.elements) {
      if (other.id === elementId) continue;
      const otherBounds = elementBounds(other);
      if (!otherBounds) continue;
      const overlapBounds = intersection(targetBounds, otherBounds);
      if (!overlapBounds) continue;
      const intersectionArea = area(overlapBounds);
      intersections.push(overlapBounds);
      overlaps.push({
        elementId: other.id,
        overlapPercent: round2((intersectionArea / targetArea) * 100),
        intersectionArea: round2(intersectionArea),
        bounds: overlapBounds
      });
    }
    if (overlaps.length === 0) continue;
    overlaps.sort((a, b) => b.overlapPercent - a.overlapPercent || a.elementId.localeCompare(b.elementId));
    const overlapArea = unionArea(intersections);
    const overlapPercent = round2((overlapArea / targetArea) * 100);
    const overlapSummary = overlaps.map((overlap) => `${overlap.elementId}: ${overlap.overlapPercent}%`).join(', ');
    warnings.push({
      code: 'element_overlap',
      elementId,
      message: `Placed node "${elementId}" overlaps ${overlaps.length} other node(s); ${overlapPercent}% of "${elementId}" is covered by existing/final nodes (${overlapSummary}).`,
      overlapPercent,
      overlapArea: round2(overlapArea),
      bounds: targetBounds,
      overlaps
    });
  }
  return warnings;
}
