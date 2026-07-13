import type { CanvasElement, JsonObject, LegacyElementImportResult } from '@agentcanvas/plugin-sdk';

const allowed = new Set([
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
  'metadata',
  'markdown'
]);

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

export function importLegacyMarkdown(legacy: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  if (legacy.type !== 'markdown') throw new TypeError(`unsupported Markdown legacy type: ${String(legacy.type)}`);
  const unknown = Object.keys(legacy).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`unknown legacy Markdown fields: ${unknown.sort().join(', ')}`);
  if (typeof legacy.id !== 'string' || typeof legacy.markdown !== 'string')
    throw new TypeError('legacy Markdown requires id and markdown');
  const element: CanvasElement = {
    id: legacy.id,
    type: 'agentcanvas.markdown/document',
    schemaVersion: 1,
    x: finite(legacy.x, 'element.x'),
    y: finite(legacy.y, 'element.y'),
    data: { markdown: legacy.markdown }
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
  return { element };
}
