import type { JsonObject } from '@agentcanvas/plugin-sdk';
import type { AssetReference, BBox, BBoxData, OverlayPath, PathData, ResolvedBBoxData } from './contracts.js';

export const BBOX_LAYOUT_SCHEMA = 'bbox-layout/v1';
export const MAX_OVERLAY_ITEMS = 500;
export const MAX_PATH_LENGTH = 20_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function positive(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number <= 0) throw new TypeError(`${label} must be positive`);
  return number;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function optionalString(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === null || typeof value === 'string') return value as string | null | undefined;
  throw new TypeError(`${label} must be a string or null`);
}

function optionalNumber(value: unknown, label: string): number | null | undefined {
  return value === undefined || value === null ? value : finite(value, label);
}

function jsonObject(value: unknown, label: string): JsonObject {
  return object(value, label) as JsonObject;
}

export function normalizeBBox(value: unknown): BBox {
  const source = object(value, 'bbox');
  const result: BBox = {
    id: id(source.id, 'bbox.id'),
    x: finite(source.x, 'bbox.x'),
    y: finite(source.y, 'bbox.y'),
    width: positive(source.width, 'bbox.width'),
    height: positive(source.height, 'bbox.height')
  };
  for (const key of ['label', 'color', 'fill'] as const) {
    const child = optionalString(source[key], `bbox.${key}`);
    if (child !== undefined) result[key] = child;
  }
  for (const key of ['strokeWidth', 'labelPadding'] as const) {
    const child = optionalNumber(source[key], `bbox.${key}`);
    if (child !== undefined) result[key] = child;
  }
  for (const [key, values] of [
    ['labelAlign', ['left', 'center', 'right']],
    ['labelVerticalAlign', ['top', 'middle', 'bottom']]
  ] as const) {
    const child = source[key];
    if (child !== undefined) {
      if (child !== null && (typeof child !== 'string' || !values.includes(child as never)))
        throw new TypeError(`bbox.${key} is invalid`);
      result[key] = child as never;
    }
  }
  if (source.metadata !== undefined) result.metadata = jsonObject(source.metadata, 'bbox.metadata');
  return result;
}

export function normalizePath(value: unknown): OverlayPath {
  const source = object(value, 'path');
  if (typeof source.d !== 'string' || !source.d.trim() || source.d.length > MAX_PATH_LENGTH)
    throw new TypeError('path.d must be a non-empty bounded SVG path');
  const result: OverlayPath = { id: id(source.id, 'path.id'), d: source.d };
  for (const key of ['label', 'color', 'fill'] as const) {
    const child = optionalString(source[key], `path.${key}`);
    if (child !== undefined) result[key] = child;
  }
  const strokeWidth = optionalNumber(source.strokeWidth, 'path.strokeWidth');
  if (strokeWidth !== undefined) result.strokeWidth = strokeWidth;
  if (source.metadata !== undefined) result.metadata = jsonObject(source.metadata, 'path.metadata');
  return result;
}

function common(source: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const key of ['caption', 'alt', 'background'] as const) {
    const child = optionalString(source[key], key);
    if (child !== undefined) result[key] = child;
  }
  if (source.showLabels !== undefined) {
    if (source.showLabels !== null && typeof source.showLabels !== 'boolean')
      throw new TypeError('showLabels must be boolean or null');
    result.showLabels = source.showLabels as boolean | null;
  }
  return result;
}

export function normalizeInlineBBoxData(value: unknown): BBoxData {
  const source = object(value, 'bbox data');
  if (!Array.isArray(source.boxes) || source.boxes.length > MAX_OVERLAY_ITEMS)
    throw new TypeError('bbox boxes must be a bounded array');
  return {
    ...common(source),
    canvasWidth: positive(source.canvasWidth, 'canvasWidth'),
    canvasHeight: positive(source.canvasHeight, 'canvasHeight'),
    boxes: source.boxes.map(normalizeBBox),
    ...(source.imageAssetRef !== undefined ? { imageAssetRef: source.imageAssetRef as AssetReference | null } : {})
  };
}

export function normalizePathData(value: unknown): PathData {
  const source = object(value, 'path data');
  if (!Array.isArray(source.paths) || source.paths.length > MAX_OVERLAY_ITEMS)
    throw new TypeError('paths must be a bounded array');
  return {
    ...common(source),
    canvasWidth: positive(source.canvasWidth, 'canvasWidth'),
    canvasHeight: positive(source.canvasHeight, 'canvasHeight'),
    paths: source.paths.map(normalizePath)
  } as PathData;
}

export function normalizeLayoutDocument(value: unknown): ResolvedBBoxData & { imageAssetRef?: AssetReference | null } {
  const source = object(value, 'bbox layout');
  if ((source.schema ?? BBOX_LAYOUT_SCHEMA) !== BBOX_LAYOUT_SCHEMA)
    throw new TypeError(`bbox layout schema must be ${BBOX_LAYOUT_SCHEMA}`);
  const inline = normalizeInlineBBoxData(source);
  return {
    canvasWidth: inline.canvasWidth as number,
    canvasHeight: inline.canvasHeight as number,
    boxes: inline.boxes as BBox[],
    ...(inline.caption !== undefined ? { caption: inline.caption } : {}),
    ...(inline.alt !== undefined ? { alt: inline.alt } : {}),
    ...(inline.showLabels !== undefined ? { showLabels: inline.showLabels } : {}),
    ...(inline.background !== undefined ? { background: inline.background } : {}),
    ...(source.imageAssetRef !== undefined ? { imageAssetRef: source.imageAssetRef as AssetReference | null } : {})
  };
}
