export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonSchema = boolean | JsonObject;

export type DeepReadonlyJson<T extends JsonValue> = T extends JsonPrimitive
  ? T
  : T extends JsonValue[]
    ? readonly DeepReadonlyJson<T[number]>[]
    : T extends JsonObject
      ? { readonly [K in keyof T]: DeepReadonlyJson<T[K]> }
      : never;

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isSafeInteger(value) === Number.isInteger(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === 'object' && isJsonValue(value);
}
