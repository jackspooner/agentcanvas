import type { AssetReference, BBoxOverlayBox } from './contracts.js';

export const BBOX_LAYOUT_ASSET_SCHEMA = 'bbox-layout/v1';

export interface BBoxLayoutAssetDocument {
  schema: typeof BBOX_LAYOUT_ASSET_SCHEMA;
  canvasWidth: number;
  canvasHeight: number;
  boxes: BBoxOverlayBox[];
  imageAssetRef?: AssetReference | null | undefined;
  caption?: string | null | undefined;
  alt?: string | null | undefined;
  showLabels?: boolean | null | undefined;
  background?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

interface NormalizeBBoxLayoutOptions {
  validateAssetRef?: (value: unknown) => AssetReference;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  return value;
}

function optionalNumber(value: unknown, name: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return finiteNumber(value, name);
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  fail(`${name} is invalid`);
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    fail(`${label} must be a safe non-empty string`);
  }
  return value;
}

export function normalizeBBoxOverlayBox(value: unknown): BBoxOverlayBox {
  if (!isObject(value)) fail('bbox layout boxes must be objects');
  const id = safeId(value.id, 'bbox.id');
  const x = finiteNumber(value.x, `bbox.${id}.x`);
  const y = finiteNumber(value.y, `bbox.${id}.y`);
  const width = finiteNumber(value.width, `bbox.${id}.width`);
  const height = finiteNumber(value.height, `bbox.${id}.height`);
  if (width <= 0 || height <= 0) fail(`bbox.${id} width and height must be positive`);
  return {
    id,
    x,
    y,
    width,
    height,
    label: typeof value.label === 'string' || value.label == null ? value.label as string | null | undefined : fail('bbox label must be string'),
    color: typeof value.color === 'string' || value.color == null ? value.color as string | null | undefined : fail('bbox color must be string'),
    fill: typeof value.fill === 'string' || value.fill == null ? value.fill as string | null | undefined : fail('bbox fill must be string'),
    strokeWidth: optionalNumber(value.strokeWidth, 'bbox.strokeWidth'),
    labelAlign: optionalEnum(value.labelAlign, ['left', 'center', 'right'] as const, 'bbox.labelAlign'),
    labelVerticalAlign: optionalEnum(value.labelVerticalAlign, ['top', 'middle', 'bottom'] as const, 'bbox.labelVerticalAlign'),
    labelPadding: optionalNumber(value.labelPadding, 'bbox.labelPadding'),
    metadata: isObject(value.metadata) ? value.metadata : undefined
  };
}

export function normalizeBBoxLayoutAssetDocument(value: unknown, options: NormalizeBBoxLayoutOptions = {}): BBoxLayoutAssetDocument {
  if (!isObject(value)) fail('bbox layout asset content must be an object');
  const schema = value.schema ?? BBOX_LAYOUT_ASSET_SCHEMA;
  if (schema !== BBOX_LAYOUT_ASSET_SCHEMA) fail(`bbox layout asset schema must be ${BBOX_LAYOUT_ASSET_SCHEMA}`);
  const canvasWidth = finiteNumber(value.canvasWidth, 'bboxLayout.canvasWidth');
  const canvasHeight = finiteNumber(value.canvasHeight, 'bboxLayout.canvasHeight');
  if (canvasWidth <= 0 || canvasHeight <= 0) fail('bbox layout canvasWidth and canvasHeight must be positive');
  if (!Array.isArray(value.boxes)) fail('bbox layout requires boxes array');
  return {
    schema: BBOX_LAYOUT_ASSET_SCHEMA,
    canvasWidth,
    canvasHeight,
    boxes: value.boxes.map(normalizeBBoxOverlayBox),
    imageAssetRef: value.imageAssetRef == null
      ? value.imageAssetRef as null | undefined
      : options.validateAssetRef
        ? options.validateAssetRef(value.imageAssetRef)
        : value.imageAssetRef as AssetReference,
    caption: typeof value.caption === 'string' || value.caption == null ? value.caption as string | null | undefined : fail('bbox layout caption must be string'),
    alt: typeof value.alt === 'string' || value.alt == null ? value.alt as string | null | undefined : fail('bbox layout alt must be string'),
    showLabels: typeof value.showLabels === 'boolean' ? value.showLabels : value.showLabels == null ? undefined : fail('bbox layout showLabels must be boolean'),
    background: typeof value.background === 'string' || value.background == null ? value.background as string | null | undefined : fail('bbox layout background must be string'),
    metadata: isObject(value.metadata) ? value.metadata : undefined
  };
}
