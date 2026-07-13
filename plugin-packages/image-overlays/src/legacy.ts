import type { CanvasElement, JsonObject, LegacyElementImportResult } from '@agentcanvas/plugin-sdk';
import { normalizeInlineBBoxData, normalizePathData } from './normalize.js';

const envelope = new Set([
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'zIndex',
  'rotation',
  'opacity',
  'locked',
  'style',
  'metadata'
]);
const bboxFields = new Set([
  'canvasWidth',
  'canvasHeight',
  'boxes',
  'layoutAssetRef',
  'imageAssetRef',
  'caption',
  'alt',
  'showLabels',
  'background'
]);
const pathFields = new Set(['canvasWidth', 'canvasHeight', 'paths', 'caption', 'alt', 'showLabels', 'background']);
const runtimeFields = new Set([
  'resolvedUrl',
  'imageResolvedUrl',
  'layoutResolvedUrl',
  'layoutSchema',
  'layoutResolutionError'
]);

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

function assetReference(value: unknown, label: string): JsonObject {
  const ref = object(value, label);
  if (
    ref.type !== 'asset' ||
    typeof ref.project !== 'string' ||
    (typeof ref.assetId !== 'string' && typeof ref.assetKey !== 'string')
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return ref;
}

function base(legacy: Readonly<Record<string, unknown>>, type: CanvasElement['type'], data: JsonObject): CanvasElement {
  if (typeof legacy.id !== 'string' || !legacy.id) throw new TypeError('legacy overlay id is required');
  const element: CanvasElement = {
    id: legacy.id,
    type,
    schemaVersion: 1,
    x: finite(legacy.x, 'element.x'),
    y: finite(legacy.y, 'element.y'),
    data
  };
  for (const key of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const) {
    const value = legacy[key];
    if (value !== undefined) element[key] = value === null ? null : finite(value, `element.${key}`);
  }
  if (legacy.locked !== undefined) {
    if (legacy.locked !== null && typeof legacy.locked !== 'boolean') throw new TypeError('element.locked is invalid');
    element.locked = legacy.locked;
  }
  if (legacy.style !== undefined) element.style = legacy.style === null ? null : object(legacy.style, 'element.style');
  if (legacy.metadata !== undefined) element.metadata = object(legacy.metadata, 'element.metadata');
  return element;
}

/** Pure, provider-independent v0.1 importer for both historical overlay types. */
export function importLegacyImageOverlay(legacy: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  if (legacy.type !== 'bboxOverlay' && legacy.type !== 'pathOverlay') {
    throw new TypeError(`unsupported overlay legacy type: ${String(legacy.type)}`);
  }
  const fields = legacy.type === 'bboxOverlay' ? bboxFields : pathFields;
  const unknown = Object.keys(legacy).filter(
    (key) => !envelope.has(key) && !fields.has(key) && !runtimeFields.has(key)
  );
  if (unknown.length) throw new TypeError(`unknown legacy overlay fields: ${unknown.sort().join(', ')}`);
  const strippedFields = Object.keys(legacy)
    .filter((key) => runtimeFields.has(key))
    .sort();
  if (legacy.type === 'pathOverlay') {
    const data = normalizePathData(Object.fromEntries([...pathFields].map((key) => [key, legacy[key]])));
    return {
      element: base(legacy, 'agentcanvas.image-overlays/path', data as unknown as JsonObject),
      ...(strippedFields.length ? { strippedFields } : {})
    };
  }
  const raw: JsonObject = {};
  for (const key of bboxFields) if (legacy[key] !== undefined) raw[key] = legacy[key] as never;
  if (raw.layoutAssetRef) {
    raw.layoutAssetRef = assetReference(raw.layoutAssetRef, 'layoutAssetRef');
    if (raw.imageAssetRef) raw.imageAssetRef = assetReference(raw.imageAssetRef, 'imageAssetRef');
  } else {
    Object.assign(raw, normalizeInlineBBoxData(raw));
    if (raw.imageAssetRef) raw.imageAssetRef = assetReference(raw.imageAssetRef, 'imageAssetRef');
  }
  return {
    element: base(legacy, 'agentcanvas.image-overlays/bbox', raw),
    ...(strippedFields.length ? { strippedFields } : {})
  };
}
