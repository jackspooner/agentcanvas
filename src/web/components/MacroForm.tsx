import type { JsonObject, JsonSchema, JsonValue } from '@agentcanvas/plugin-sdk';
import React, { useEffect, useMemo, useState } from 'react';
import { applyMacroInputDefaults } from '../../macros/input-defaults';

export interface MacroFormChange {
  input: JsonObject;
  valid: boolean;
  errors: readonly string[];
}

interface MacroFormProps {
  schema: JsonSchema;
  onChange(change: MacroFormChange): void;
  onUserChange?(): void;
  disabled?: boolean;
}

type SchemaObject = JsonObject & { type?: JsonValue; properties?: JsonValue; required?: JsonValue; enum?: JsonValue };

function schemaObject(value: JsonSchema | undefined): SchemaObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SchemaObject) : null;
}

function schemaType(schema: SchemaObject): string | null {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) {
    const candidate = schema.type.find((value) => typeof value === 'string' && value !== 'null');
    return typeof candidate === 'string' ? candidate : null;
  }
  return null;
}

function propertySchemas(schema: JsonSchema): Array<[string, SchemaObject]> {
  const root = schemaObject(schema);
  if (!root || !root.properties || typeof root.properties !== 'object' || Array.isArray(root.properties)) return [];
  return Object.entries(root.properties).flatMap(([key, value]) => {
    const property = schemaObject(value as JsonSchema);
    return property ? [[key, property]] : [];
  });
}

function requiredProperties(schema: JsonSchema): Set<string> {
  const root = schemaObject(schema);
  if (!root || !Array.isArray(root.required)) return new Set();
  return new Set(root.required.filter((value): value is string => typeof value === 'string'));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value && typeof value === 'object' && Object.values(value).every(isJsonValue));
}

function labelFor(key: string, schema: SchemaObject): string {
  return typeof schema.title === 'string' && schema.title.length > 0 ? schema.title : key;
}

function jsonText(value: JsonValue | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function isMultiline(schema: SchemaObject): boolean {
  return schema.format === 'textarea' || schema.format === 'multiline' || schema['x-agentcanvas-multiline'] === true;
}

export function MacroForm({ schema, onChange, onUserChange, disabled = false }: MacroFormProps) {
  const properties = useMemo(() => propertySchemas(schema), [schema]);
  const [input, setInput] = useState<JsonObject>(() => applyMacroInputDefaults(schema, {}));
  const [jsonEditors, setJsonEditors] = useState<Record<string, string>>(() =>
    Object.fromEntries(properties.flatMap(([key]) => (key in input ? [[key, jsonText(input[key])]] : [])))
  );
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const next = applyMacroInputDefaults(schema, {});
    setInput(next);
    setJsonEditors(Object.fromEntries(Object.entries(next).map(([key, value]) => [key, jsonText(value)])));
    setEditorErrors({});
  }, [schema]);

  const errors = useMemo(() => Object.values(editorErrors), [editorErrors]);

  useEffect(() => {
    onChange({ input, valid: errors.length === 0, errors });
  }, [errors, input, onChange]);

  function updatePrimitive(key: string, value: JsonValue | undefined) {
    onUserChange?.();
    const next = { ...input };
    if (value === undefined) delete next[key];
    else next[key] = value;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      setEditorErrors((current) => ({ ...current, [key]: 'Enter a finite number.' }));
      return;
    }
    setEditorErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setInput(applyMacroInputDefaults(schema, next));
  }

  function updateJson(key: string, text: string) {
    onUserChange?.();
    setJsonEditors((current) => ({ ...current, [key]: text }));
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isJsonValue(parsed)) throw new Error('JSON value is not supported.');
      const next = { ...input, [key]: parsed };
      setEditorErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      const defaulted = applyMacroInputDefaults(schema, next);
      setInput(defaulted);
      setJsonEditors((current) => ({ ...current, [key]: jsonText(defaulted[key]) }));
    } catch {
      setEditorErrors((current) => ({ ...current, [key]: 'Enter valid JSON.' }));
    }
  }

  return (
    <div className="macro-form">
      {properties.map(([key, property]) => {
        const id = `macro-input-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
        const label = labelFor(key, property);
        const type = schemaType(property);
        const required = requiredProperties(schema).has(key);
        const enumValues = Array.isArray(property.enum) ? property.enum.filter(isJsonValue) : null;
        const value = input[key];
        const jsonField = type === 'array' || type === 'object';
        const error = editorErrors[key];
        return (
          <div className="macro-form-field" key={key}>
            <label htmlFor={id}>
              <span>
                {label}
                {required && <span aria-hidden="true"> *</span>}
              </span>
              {property.description && <small>{String(property.description)}</small>}
            </label>
            {enumValues ? (
              <select
                id={id}
                value={value === undefined ? '' : JSON.stringify(value)}
                disabled={disabled}
                required={required}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) =>
                  updatePrimitive(key, event.target.value === '' ? undefined : JSON.parse(event.target.value))
                }
              >
                <option value="">Choose a value</option>
                {enumValues.map((option) => (
                  <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
                    {typeof option === 'string' ? option : JSON.stringify(option)}
                  </option>
                ))}
              </select>
            ) : jsonField ? (
              <textarea
                id={id}
                className="macro-json-editor"
                value={jsonEditors[key] ?? jsonText(value)}
                disabled={disabled}
                required={required}
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => updateJson(key, event.target.value)}
              />
            ) : type === 'boolean' ? (
              <input
                id={id}
                type="checkbox"
                checked={value === true}
                disabled={disabled}
                required={required}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => updatePrimitive(key, event.target.checked)}
              />
            ) : type === 'number' || type === 'integer' ? (
              <input
                id={id}
                type="number"
                value={value === undefined ? '' : String(value)}
                disabled={disabled}
                required={required}
                min={typeof property.minimum === 'number' ? property.minimum : undefined}
                max={typeof property.maximum === 'number' ? property.maximum : undefined}
                step={type === 'integer' ? 1 : 'any'}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  if (event.target.value === '') updatePrimitive(key, undefined);
                  else updatePrimitive(key, Number(event.target.value));
                }}
              />
            ) : isMultiline(property) ? (
              <textarea
                id={id}
                value={value === undefined ? '' : String(value)}
                disabled={disabled}
                required={required}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => updatePrimitive(key, event.target.value)}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value === undefined ? '' : String(value)}
                disabled={disabled}
                required={required}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => updatePrimitive(key, event.target.value)}
              />
            )}
            {error && (
              <div id={`${id}-error`} className="macro-field-error" role="alert">
                {error}
              </div>
            )}
          </div>
        );
      })}
      {errors.length > 0 && (
        <div className="macro-form-summary" role="status">
          Complete the highlighted fields before previewing.
        </div>
      )}
    </div>
  );
}
