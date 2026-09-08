import type { DatabaseSync } from 'node:sqlite';
import type { AgentCanvasConfiguration, UpdateAgentCanvasConfigurationInput } from '../configuration';
import { DEFAULT_DIAGNOSTICS_CONFIGURATION, normalizeDiagnosticsConfiguration } from '../configuration';
import type { CanvasBounds } from '../contracts';
import { normalizeCanvasBounds } from '../validation';

interface ConfigurationRow {
  configuration_json: string;
  updated_at: string;
}

function configurationDocument(row: ConfigurationRow | undefined): Record<string, unknown> {
  if (!row) return {};
  const parsed = JSON.parse(row.configuration_json);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function readAgentCanvasConfiguration(db: DatabaseSync, runtimeDefault: CanvasBounds): AgentCanvasConfiguration {
  const row = db
    .prepare('SELECT configuration_json, updated_at FROM agent_canvas_configuration WHERE id = 1')
    .get() as unknown as ConfigurationRow | undefined;
  if (!row) {
    return {
      defaultCanvasSize: normalizeCanvasBounds(runtimeDefault),
      diagnostics: { ...DEFAULT_DIAGNOSTICS_CONFIGURATION },
      source: 'runtime-default',
      updatedAt: null
    };
  }
  const document = configurationDocument(row);
  return {
    defaultCanvasSize: normalizeCanvasBounds(document.defaultCanvasSize),
    diagnostics:
      document.diagnostics === undefined
        ? { ...DEFAULT_DIAGNOSTICS_CONFIGURATION }
        : normalizeDiagnosticsConfiguration(document.diagnostics),
    source: 'stored',
    updatedAt: row.updated_at
  };
}

export function writeAgentCanvasConfiguration(
  db: DatabaseSync,
  input: UpdateAgentCanvasConfigurationInput,
  runtimeDefault: CanvasBounds
): AgentCanvasConfiguration {
  const current = readAgentCanvasConfiguration(db, runtimeDefault);
  const updatedAt = new Date().toISOString();
  const existing = db
    .prepare('SELECT configuration_json, updated_at FROM agent_canvas_configuration WHERE id = 1')
    .get() as unknown as ConfigurationRow | undefined;
  const configuration = {
    ...configurationDocument(existing),
    defaultCanvasSize: input.defaultCanvasSize ?? current.defaultCanvasSize,
    diagnostics: input.diagnostics ?? current.diagnostics
  };
  db.prepare(`INSERT INTO agent_canvas_configuration (id, configuration_json, updated_at, actor)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      configuration_json = excluded.configuration_json,
      updated_at = excluded.updated_at,
      actor = excluded.actor`).run(JSON.stringify(configuration), updatedAt, input.actor ?? null);
  return readAgentCanvasConfiguration(db, runtimeDefault);
}
