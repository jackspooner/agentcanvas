import type { JsonObject, JsonSchema, JsonValue } from '@agentcanvas/plugin-sdk';

type SchemaRecord = Record<string, unknown>;

function schemaRecord(schema: JsonSchema | undefined): SchemaRecord | null {
  return schema && typeof schema === 'object' && !Array.isArray(schema) ? (schema as SchemaRecord) : null;
}

function cloneJson(value: JsonValue): JsonValue {
  return structuredClone(value);
}

function applyDefaults(value: unknown, schema: JsonSchema | undefined): unknown {
  const definition = schemaRecord(schema);
  if (value === undefined) {
    if (!definition || !('default' in definition) || !isJsonValue(definition.default)) return undefined;
    value = cloneJson(definition.default);
  }

  if (Array.isArray(value)) {
    const items = definition?.items;
    if (Array.isArray(items)) {
      return value.map((item, index) => applyDefaults(item, items[index] as JsonSchema | undefined));
    }
    return items && typeof items === 'object' ? value.map((item) => applyDefaults(item, items as JsonSchema)) : value;
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    definition?.properties &&
    typeof definition.properties === 'object'
  ) {
    const result = value as Record<string, unknown>;
    for (const [key, propertySchema] of Object.entries(definition.properties as SchemaRecord)) {
      const next = applyDefaults(result[key], propertySchema as JsonSchema);
      if (next !== undefined) result[key] = next;
    }
  }
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value && typeof value === 'object' && Object.values(value).every(isJsonValue));
}

export function applyMacroInputDefaults(schema: JsonSchema, raw: JsonObject): JsonObject {
  return applyDefaults(structuredClone(raw), schema) as JsonObject;
}
