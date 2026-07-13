import type {
  AssetsCapabilityV1,
  CanvasElement,
  JsonObject,
  JsonValue,
  LegacyElementImportResult
} from '@agentcanvas/plugin-sdk';

const baseFields = new Set([
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
const dataFields = ['assetRef', 'caption', 'fit', 'alt'] as const;
const responseOnlyFields = ['resolvedUrl'] as const;

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

function optionalObject(value: unknown, label: string): JsonObject | null | undefined {
  if (value === undefined || value === null) return value;
  return jsonObject(value, label);
}

export function importLegacyAsset(
  legacy: Readonly<Record<string, unknown>>,
  validateReference: AssetsCapabilityV1['validateReference']
): LegacyElementImportResult {
  if (legacy.type !== 'asset') throw new TypeError(`unsupported Assets-2 legacy type: ${String(legacy.type)}`);
  const allowed = new Set([...baseFields, ...dataFields, ...responseOnlyFields]);
  const unknown = Object.keys(legacy).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`unknown legacy asset fields: ${unknown.sort().join(', ')}`);
  if (typeof legacy.id !== 'string' || !legacy.id) throw new TypeError('legacy asset id is required');
  const data: JsonObject = { assetRef: validateReference(legacy.assetRef) };
  if (legacy.caption !== undefined) {
    if (legacy.caption !== null && typeof legacy.caption !== 'string')
      throw new TypeError('legacy asset caption is invalid');
    data.caption = legacy.caption as JsonValue;
  }
  if (legacy.fit !== undefined) {
    if (legacy.fit !== null && !['contain', 'cover', 'stretch', 'original'].includes(String(legacy.fit))) {
      throw new TypeError('legacy asset fit is invalid');
    }
    data.fit = legacy.fit as JsonValue;
  }
  if (legacy.alt !== undefined) {
    if (legacy.alt !== null && typeof legacy.alt !== 'string') throw new TypeError('legacy asset alt is invalid');
    data.alt = legacy.alt as JsonValue;
  }
  const element: CanvasElement = {
    id: legacy.id,
    type: 'agentcanvas.assets2/asset',
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
    element.locked = legacy.locked as boolean | null;
  }
  if (legacy.style !== undefined) element.style = optionalObject(legacy.style, 'element.style');
  if (legacy.metadata !== undefined) element.metadata = jsonObject(legacy.metadata, 'element.metadata');
  return {
    element,
    ...(Object.hasOwn(legacy, 'resolvedUrl') ? { strippedFields: ['resolvedUrl'] } : {})
  };
}
