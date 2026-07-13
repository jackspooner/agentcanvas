import type { CanvasElement, JsonObject, JsonValue, LegacyElementImportResult } from '@agentcanvas/plugin-sdk';

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

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

function optionalJsonObject(value: unknown, label: string): JsonObject | null | undefined {
  if (value === undefined || value === null) return value;
  return jsonObject(value, label);
}

function copyBase(legacy: Readonly<Record<string, unknown>>, type: string, data: JsonObject): CanvasElement {
  if (typeof legacy.id !== 'string' || !legacy.id) throw new TypeError('legacy element id is required');
  const element: CanvasElement = {
    id: legacy.id,
    type: type as CanvasElement['type'],
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
  if (legacy.style !== undefined) element.style = optionalJsonObject(legacy.style, 'element.style');
  if (legacy.metadata !== undefined) element.metadata = jsonObject(legacy.metadata, 'element.metadata');
  return element;
}

function assertKnown(legacy: Readonly<Record<string, unknown>>, own: readonly string[]): void {
  const allowed = new Set([...baseFields, ...own]);
  const unknown = Object.keys(legacy).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`unknown legacy primitive fields: ${unknown.sort().join(', ')}`);
}

function endpoint(value: unknown): JsonObject {
  const source = jsonObject(value, 'connector endpoint');
  const allowed = new Set(['elementId', 'x', 'y', 'anchor']);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`unknown connector endpoint fields: ${unknown.join(', ')}`);
  return { ...source } as JsonObject;
}

export function importLegacyPrimitive(legacy: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  switch (legacy.type) {
    case 'text': {
      assertKnown(legacy, ['text']);
      if (typeof legacy.text !== 'string') throw new TypeError('legacy text must be a string');
      return { element: copyBase(legacy, 'agentcanvas.primitives/text', { text: legacy.text }) };
    }
    case 'shape': {
      assertKnown(legacy, ['shape', 'label']);
      if (legacy.shape !== 'rect' && legacy.shape !== 'ellipse' && legacy.shape !== 'diamond') {
        throw new TypeError('legacy shape must be rect, ellipse, or diamond');
      }
      const data: JsonObject = { shape: legacy.shape };
      if (legacy.label !== undefined) data.label = legacy.label as JsonValue;
      return { element: copyBase(legacy, 'agentcanvas.primitives/shape', data) };
    }
    case 'line':
    case 'arrow': {
      assertKnown(legacy, ['from', 'to', 'label', 'stroke', 'strokeWidth']);
      const data: JsonObject = { from: endpoint(legacy.from), to: endpoint(legacy.to) };
      for (const key of ['label', 'stroke', 'strokeWidth'] as const) {
        if (legacy[key] !== undefined) data[key] = legacy[key] as JsonValue;
      }
      return { element: copyBase(legacy, `agentcanvas.primitives/${legacy.type}`, data) };
    }
    default:
      throw new TypeError(`unsupported primitive legacy type: ${String(legacy.type)}`);
  }
}
