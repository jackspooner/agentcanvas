import { createHash } from 'node:crypto';
import type { JsonValue } from '@agentcanvas/plugin-sdk';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value as JsonValue));
}

export function sha256(value: unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : canonicalJson(value))
    .digest('hex');
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])])
    ) as JsonValue;
  }
  return value;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
