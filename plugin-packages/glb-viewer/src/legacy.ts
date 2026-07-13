import type { CanvasElement, JsonObject, LegacyElementImportResult } from '@agentcanvas/plugin-sdk';

const baseFields = [
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
];
const ownFields = ['assetRef', 'posterAssetRef', 'caption', 'alt', 'cameraControls', 'autoRotate'];
const runtimeFields = ['resolvedUrl', 'posterResolvedUrl'];

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

function option(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

export function importLegacyModel(legacy: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  if (legacy.type !== 'glbViewer') throw new TypeError(`unsupported GLB legacy type: ${String(legacy.type)}`);
  const allowed = new Set([...baseFields, ...ownFields, ...runtimeFields]);
  const unknown = Object.keys(legacy).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`unknown legacy GLB fields: ${unknown.sort().join(', ')}`);
  if (typeof legacy.id !== 'string') throw new TypeError('legacy GLB id is required');
  const data: JsonObject = {
    assetRef: object(legacy.assetRef, 'model.assetRef'),
    cameraControls: option(legacy.cameraControls, true, 'model.cameraControls'),
    autoRotate: option(legacy.autoRotate, false, 'model.autoRotate')
  };
  for (const key of ['caption', 'alt', 'posterAssetRef'] as const)
    if (legacy[key] !== undefined) data[key] = legacy[key] as JsonObject | string | null;
  const element: CanvasElement = {
    id: legacy.id,
    type: 'agentcanvas.glb-viewer/model',
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
    if (legacy.locked !== null && typeof legacy.locked !== 'boolean')
      throw new TypeError('element.locked must be boolean');
    element.locked = legacy.locked as boolean | null;
  }
  if (legacy.style !== undefined) element.style = legacy.style === null ? null : object(legacy.style, 'element.style');
  if (legacy.metadata !== undefined) element.metadata = object(legacy.metadata, 'element.metadata');
  return { element, strippedFields: runtimeFields.filter((key) => legacy[key] !== undefined) };
}
