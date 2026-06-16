import { CanvasError } from './errors';
import type { AssetReference, BBoxOverlayBox, CanvasElement, CanvasOperation, CanvasViewport, CanvasViewportInput, ConnectorEndpoint, TableElement, VideoElement } from './contracts';

export const LIMITS = {
  maxCanvasWidth: 20_000,
  maxCanvasHeight: 20_000,
  maxElements: 2_000,
  maxMarkdownLength: 20_000,
  maxTextLength: 20_000,
  maxTableColumns: 50,
  maxTableRows: 500,
  maxTableCellLength: 2_000,
  maxBBoxes: 500,
  minZoom: 0.05,
  maxZoom: 8,
  defaultViewportWidth: 1920,
  defaultViewportHeight: 900
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_PROJECT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validation(message: string): never {
  throw new CanvasError('validation_error', message, 'validation', 400, false);
}

function finiteNumber(value: unknown, name: string, fallback?: number): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    validation(`${name} is required`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) validation(`${name} must be a finite number`);
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
  validation(`${name} is invalid`);
}

export function validateSafeId(value: unknown, label = 'id'): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) validation(`${label} must be a safe non-empty string`);
  return value;
}

export function validateAssetRef(value: unknown): AssetReference {
  if (!isObject(value)) validation('asset element requires an Assets-2 asset ref object, not a local path or URL');
  if (value.type !== 'asset') validation('asset ref type must be "asset"');
  if (typeof value.project !== 'string' || !SAFE_PROJECT.test(value.project)) validation('asset ref project must be a safe segment');
  if (typeof value.assetId !== 'string' || !UUID.test(value.assetId)) validation('asset ref assetId must be a UUID');
  if (value.assetBaseUrl !== undefined && value.assetBaseUrl !== null) {
    if (typeof value.assetBaseUrl !== 'string' || !/^https?:\/\/127\.0\.0\.1:\d+/.test(value.assetBaseUrl)) {
      validation('assetBaseUrl must be a localhost HTTP URL when provided');
    }
  }
  return { type: 'asset', project: value.project, assetId: value.assetId, assetBaseUrl: value.assetBaseUrl as string | undefined };
}

export function resolveAssetRecordUrl(ref: AssetReference, defaultBaseUrl = 'http://127.0.0.1:23000'): string {
  const checked = validateAssetRef(ref);
  const base = (checked.assetBaseUrl ?? defaultBaseUrl).replace(/\/+$/, '');
  return `${base}/projects/${encodeURIComponent(checked.project)}/assets/${encodeURIComponent(checked.assetId)}`;
}

export function resolveAssetContentUrl(ref: AssetReference, defaultBaseUrl = 'http://127.0.0.1:23000'): string {
  return `${resolveAssetRecordUrl(ref, defaultBaseUrl)}/content`;
}

function bboxBox(value: unknown): BBoxOverlayBox {
  if (!isObject(value)) validation('bboxOverlay boxes must be objects');
  const id = validateSafeId(value.id, 'bbox.id');
  const x = finiteNumber(value.x, `bbox.${id}.x`);
  const y = finiteNumber(value.y, `bbox.${id}.y`);
  const width = finiteNumber(value.width, `bbox.${id}.width`);
  const height = finiteNumber(value.height, `bbox.${id}.height`);
  if (width <= 0 || height <= 0) validation(`bbox.${id} width and height must be positive`);
  return {
    id,
    x,
    y,
    width,
    height,
    label: typeof value.label === 'string' || value.label == null ? value.label as string | null | undefined : validation('bbox label must be string'),
    color: typeof value.color === 'string' || value.color == null ? value.color as string | null | undefined : validation('bbox color must be string'),
    fill: typeof value.fill === 'string' || value.fill == null ? value.fill as string | null | undefined : validation('bbox fill must be string'),
    strokeWidth: optionalNumber(value.strokeWidth, 'bbox.strokeWidth'),
    labelAlign: optionalEnum(value.labelAlign, ['left', 'center', 'right'] as const, 'bbox.labelAlign'),
    labelVerticalAlign: optionalEnum(value.labelVerticalAlign, ['top', 'middle', 'bottom'] as const, 'bbox.labelVerticalAlign'),
    labelPadding: optionalNumber(value.labelPadding, 'bbox.labelPadding'),
    metadata: isObject(value.metadata) ? value.metadata : undefined
  };
}

function endpoint(value: unknown): ConnectorEndpoint {
  if (!isObject(value)) validation('connector endpoint must be an object');
  const out: ConnectorEndpoint = {};
  if ('elementId' in value) out.elementId = value.elementId == null ? null : validateSafeId(value.elementId, 'endpoint.elementId');
  if ('x' in value) out.x = optionalNumber(value.x, 'endpoint.x');
  if ('y' in value) out.y = optionalNumber(value.y, 'endpoint.y');
  if ('anchor' in value) {
    if (value.anchor == null) out.anchor = null;
    else if (['center', 'top', 'right', 'bottom', 'left'].includes(String(value.anchor))) out.anchor = value.anchor as ConnectorEndpoint['anchor'];
    else validation('endpoint.anchor is invalid');
  }
  if (!out.elementId && (out.x == null || out.y == null)) validation('connector endpoint needs elementId or x/y');
  return out;
}

function base(input: Record<string, unknown>) {
  return {
    id: validateSafeId(input.id, 'element.id'),
    x: finiteNumber(input.x, 'element.x'),
    y: finiteNumber(input.y, 'element.y'),
    width: optionalNumber(input.width, 'element.width'),
    height: optionalNumber(input.height, 'element.height'),
    zIndex: optionalNumber(input.zIndex, 'element.zIndex'),
    rotation: optionalNumber(input.rotation, 'element.rotation'),
    opacity: optionalNumber(input.opacity, 'element.opacity'),
    locked: typeof input.locked === 'boolean' ? input.locked : input.locked == null ? input.locked as null | undefined : validation('element.locked must be boolean'),
    style: isObject(input.style) ? input.style : input.style == null ? input.style as null | undefined : validation('element.style must be object'),
    metadata: isObject(input.metadata) ? input.metadata : undefined
  };
}

export function normalizeCanvasElement(value: unknown): CanvasElement {
  if (!isObject(value)) validation('element must be an object');
  if (typeof value.type !== 'string') validation('element.type is required');
  const b = base(value);
  switch (value.type) {
    case 'text': {
      if (typeof value.text !== 'string') validation('text element requires text');
      if (value.text.length > LIMITS.maxTextLength) validation('text element is too long');
      return { ...b, type: 'text', text: value.text };
    }
    case 'markdown': {
      if (typeof value.markdown !== 'string') validation('markdown element requires markdown');
      if (value.markdown.length > LIMITS.maxMarkdownLength) validation('markdown element is too long');
      return { ...b, type: 'markdown', markdown: value.markdown };
    }
    case 'asset': {
      return {
        ...b,
        type: 'asset',
        assetRef: validateAssetRef(value.assetRef),
        caption: typeof value.caption === 'string' || value.caption == null ? value.caption as string | null | undefined : validation('asset caption must be string'),
        fit: ['contain', 'cover', 'stretch', 'original'].includes(String(value.fit)) ? value.fit as 'contain' | 'cover' | 'stretch' | 'original' : value.fit == null ? value.fit as null | undefined : validation('asset fit is invalid'),
        alt: typeof value.alt === 'string' || value.alt == null ? value.alt as string | null | undefined : validation('asset alt must be string')
      };
    }
    case 'glbViewer': {
      return {
        ...b,
        type: 'glbViewer',
        width: b.width ?? 320,
        height: b.height ?? 240,
        assetRef: validateAssetRef(value.assetRef),
        caption: typeof value.caption === 'string' || value.caption == null ? value.caption as string | null | undefined : validation('GLB viewer caption must be string'),
        alt: typeof value.alt === 'string' || value.alt == null ? value.alt as string | null | undefined : validation('GLB viewer alt must be string'),
        cameraControls: typeof value.cameraControls === 'boolean' ? value.cameraControls : value.cameraControls == null ? true : validation('GLB viewer cameraControls must be boolean'),
        autoRotate: typeof value.autoRotate === 'boolean' ? value.autoRotate : value.autoRotate == null ? false : validation('GLB viewer autoRotate must be boolean')
      };
    }
    case 'video': {
      return {
        ...b,
        type: 'video',
        width: b.width ?? 480,
        height: b.height ?? 270,
        assetRef: validateAssetRef(value.assetRef),
        caption: typeof value.caption === 'string' || value.caption == null ? value.caption as string | null | undefined : validation('video caption must be string'),
        alt: typeof value.alt === 'string' || value.alt == null ? value.alt as string | null | undefined : validation('video alt must be string'),
        controls: typeof value.controls === 'boolean' ? value.controls : value.controls == null ? true : validation('video controls must be boolean'),
        autoplay: typeof value.autoplay === 'boolean' ? value.autoplay : value.autoplay == null ? false : validation('video autoplay must be boolean'),
        loop: typeof value.loop === 'boolean' ? value.loop : value.loop == null ? false : validation('video loop must be boolean'),
        muted: typeof value.muted === 'boolean' ? value.muted : value.muted == null ? true : validation('video muted must be boolean'),
        posterAssetRef: value.posterAssetRef == null ? value.posterAssetRef as VideoElement['posterAssetRef'] : validateAssetRef(value.posterAssetRef)
      };
    }
    case 'bboxOverlay': {
      const canvasWidth = finiteNumber(value.canvasWidth, 'bboxOverlay.canvasWidth');
      const canvasHeight = finiteNumber(value.canvasHeight, 'bboxOverlay.canvasHeight');
      if (canvasWidth <= 0 || canvasHeight <= 0) validation('bboxOverlay canvasWidth and canvasHeight must be positive');
      if (!Array.isArray(value.boxes)) validation('bboxOverlay requires boxes array');
      if (value.boxes.length > LIMITS.maxBBoxes) validation('bboxOverlay has too many boxes');
      return {
        ...b,
        type: 'bboxOverlay',
        width: b.width ?? 320,
        height: b.height ?? 240,
        canvasWidth,
        canvasHeight,
        boxes: value.boxes.map(bboxBox),
        imageAssetRef: value.imageAssetRef == null ? value.imageAssetRef as null | undefined : validateAssetRef(value.imageAssetRef),
        caption: typeof value.caption === 'string' || value.caption == null ? value.caption as string | null | undefined : validation('bboxOverlay caption must be string'),
        alt: typeof value.alt === 'string' || value.alt == null ? value.alt as string | null | undefined : validation('bboxOverlay alt must be string'),
        showLabels: typeof value.showLabels === 'boolean' ? value.showLabels : value.showLabels == null ? true : validation('bboxOverlay showLabels must be boolean'),
        background: typeof value.background === 'string' || value.background == null ? value.background as string | null | undefined : validation('bboxOverlay background must be string')
      };
    }
    case 'line':
    case 'arrow': {
      return {
        ...b,
        type: value.type,
        from: endpoint(value.from),
        to: endpoint(value.to),
        label: typeof value.label === 'string' || value.label == null ? value.label as string | null | undefined : validation('connector label must be string'),
        stroke: typeof value.stroke === 'string' || value.stroke == null ? value.stroke as string | null | undefined : validation('connector stroke must be string'),
        strokeWidth: optionalNumber(value.strokeWidth, 'strokeWidth')
      };
    }
    case 'table': {
      if (!Array.isArray(value.columns) || !value.columns.every((v) => typeof v === 'string')) validation('table columns must be strings');
      if (!Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row) && row.every((v) => typeof v === 'string'))) validation('table rows must be string arrays');
      if (value.columns.length > LIMITS.maxTableColumns) validation('too many table columns');
      if (value.rows.length > LIMITS.maxTableRows) validation('too many table rows');
      for (const cell of value.rows.flat()) if (cell.length > LIMITS.maxTableCellLength) validation('table cell is too long');
      return { ...b, type: 'table', columns: value.columns, rows: value.rows, caption: typeof value.caption === 'string' || value.caption == null ? value.caption as TableElement['caption'] : validation('table caption must be string') };
    }
    case 'shape': {
      if (!['rect', 'ellipse', 'diamond'].includes(String(value.shape))) validation('shape must be rect, ellipse, or diamond');
      return { ...b, type: 'shape', shape: value.shape as 'rect' | 'ellipse' | 'diamond', label: typeof value.label === 'string' || value.label == null ? value.label as string | null | undefined : validation('shape label must be string') };
    }
    case 'group': {
      if (!Array.isArray(value.children) || !value.children.every((v) => typeof v === 'string' && SAFE_ID.test(v))) validation('group children must be safe element ids');
      return { ...b, type: 'group', children: value.children };
    }
    default:
      validation(`unsupported element type: ${value.type}`);
  }
}

export function normalizeOperations(operations: unknown): CanvasOperation[] {
  if (!Array.isArray(operations)) validation('operations must be an array');
  return operations.map((op) => {
    if (!isObject(op) || typeof op.op !== 'string') validation('operation requires op');
    if (op.op === 'upsertElement') return { op: 'upsertElement', element: normalizeCanvasElement(op.element) };
    if (op.op === 'patchElement') return { op: 'patchElement', elementId: validateSafeId(op.elementId, 'elementId'), patch: isObject(op.patch) ? op.patch : validation('patch must be object') };
    if (op.op === 'deleteElement') return { op: 'deleteElement', elementId: validateSafeId(op.elementId, 'elementId') };
    if (op.op === 'clear') return { op: 'clear' };
    validation(`unsupported operation: ${op.op}`);
  });
}

export function ensureElementCap(elements: CanvasElement[]): void {
  if (elements.length > LIMITS.maxElements) validation(`canvas exceeds ${LIMITS.maxElements} elements`);
}

export function defaultViewport(): CanvasViewport {
  return {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    width: LIMITS.defaultViewportWidth,
    height: LIMITS.defaultViewportHeight,
    source: 'default',
    updatedAt: null
  };
}

export function normalizeViewportInput(input: CanvasViewportInput | Record<string, unknown>, sourceFallback: 'user' | 'agent' = 'user'): Omit<CanvasViewport, 'updatedAt'> {
  if (!isObject(input)) validation('viewport payload must be an object');
  const source = input.source === 'agent' || input.source === 'user' ? input.source : sourceFallback;
  const centerX = finiteNumber(input.centerX, 'viewport.centerX', 0);
  const centerY = finiteNumber(input.centerY, 'viewport.centerY', 0);
  const zoom = finiteNumber(input.zoom, 'viewport.zoom', 1);
  if (zoom < LIMITS.minZoom || zoom > LIMITS.maxZoom) validation(`viewport.zoom must be between ${LIMITS.minZoom} and ${LIMITS.maxZoom}`);
  const width = finiteNumber(input.width, 'viewport.width', LIMITS.defaultViewportWidth);
  const height = finiteNumber(input.height, 'viewport.height', LIMITS.defaultViewportHeight);
  if (width <= 0 || height <= 0) validation('viewport width and height must be positive');
  return { centerX, centerY, zoom, width: Math.round(width), height: Math.round(height), source };
}
