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
  'columns',
  'rows',
  'caption'
]);

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonObject;
}

export function importLegacyTable(legacy: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  if (legacy.type !== 'table') throw new TypeError(`unsupported table legacy type: ${String(legacy.type)}`);
  const unknown = Object.keys(legacy).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`unknown legacy table fields: ${unknown.sort().join(', ')}`);
  if (
    typeof legacy.id !== 'string' ||
    !Array.isArray(legacy.columns) ||
    !legacy.columns.every((item) => typeof item === 'string') ||
    !Array.isArray(legacy.rows) ||
    !legacy.rows.every((row) => Array.isArray(row) && row.every((item) => typeof item === 'string'))
  ) {
    throw new TypeError('legacy table requires string columns and string-array rows');
  }
  const data: JsonObject = { columns: legacy.columns, rows: legacy.rows };
  if (legacy.caption !== undefined) data.caption = legacy.caption as string | null;
  const element: CanvasElement = {
    id: legacy.id,
    type: 'agentcanvas.table/table',
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
  return { element };
}
