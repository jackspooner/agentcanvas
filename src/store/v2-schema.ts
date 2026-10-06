export const PHYSICAL_SCHEMA_VERSION = 5;
export const DOCUMENT_SCHEMA_VERSION = 2;

export const MACRO_VERSION_DELETE_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS macro_versions_immutable_delete
BEFORE DELETE ON macro_versions
WHEN EXISTS (SELECT 1 FROM macro_definitions WHERE id = OLD.macro_id)
BEGIN
  SELECT RAISE(ABORT, 'macro version records are immutable');
END;
`;

export const MACRO_STORAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS macro_definitions (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('installation', 'canvas')),
  canvas_id TEXT,
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope_kind = 'installation' AND canvas_id IS NULL) OR
         (scope_kind = 'canvas' AND canvas_id IS NOT NULL)),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE IF NOT EXISTS macro_versions (
  macro_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  definition_json TEXT NOT NULL,
  definition_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (macro_id, version),
  FOREIGN KEY (macro_id) REFERENCES macro_definitions(id)
);

CREATE TABLE IF NOT EXISTS macro_invocations (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  resulting_revision INTEGER NOT NULL,
  macro_id TEXT NOT NULL,
  macro_version INTEGER NOT NULL,
  plan_sha256 TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  safe_summary_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (canvas_id, resulting_revision),
  UNIQUE (canvas_id, idempotency_key),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id),
  FOREIGN KEY (macro_id, macro_version) REFERENCES macro_versions(macro_id, version)
);

CREATE INDEX IF NOT EXISTS macro_definitions_canvas_id_idx ON macro_definitions(canvas_id);
CREATE INDEX IF NOT EXISTS macro_versions_macro_id_idx ON macro_versions(macro_id);
CREATE INDEX IF NOT EXISTS macro_invocations_canvas_id_idx ON macro_invocations(canvas_id);
CREATE INDEX IF NOT EXISTS macro_invocations_macro_id_idx ON macro_invocations(macro_id);

DROP TRIGGER IF EXISTS macro_versions_definition_immutable;

CREATE TRIGGER IF NOT EXISTS macro_versions_immutable_update
BEFORE UPDATE ON macro_versions
BEGIN
  SELECT RAISE(ABORT, 'macro version records are immutable');
END;

${MACRO_VERSION_DELETE_TRIGGER_SQL}
`;

export const V2_SCHEMA_SQL = `
CREATE TABLE canvases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  project TEXT,
  conversation_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bounds_json TEXT,
  background_json TEXT,
  theme_json TEXT,
  elements_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  metadata_json TEXT,
  document_version INTEGER NOT NULL CHECK (document_version = 2)
);

CREATE TABLE canvas_events (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT,
  document_version INTEGER NOT NULL,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE canvas_share_links (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  label TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE canvas_idempotency_keys (
  canvas_id TEXT NOT NULL,
  document_version INTEGER NOT NULL DEFAULT 2 CHECK (document_version = 2),
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (canvas_id, document_version, key),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE canvas_viewports (
  canvas_id TEXT NOT NULL,
  source TEXT NOT NULL,
  center_x REAL NOT NULL,
  center_y REAL NOT NULL,
  zoom REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (canvas_id, source),
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE agent_canvas_configuration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  configuration_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor TEXT
);

CREATE TABLE agent_canvas_installation_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  physical_version INTEGER NOT NULL,
  document_version INTEGER NOT NULL,
  migrated_at TEXT NOT NULL,
  tool_version TEXT NOT NULL
);

CREATE TABLE agent_canvas_migration_runs (
  id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL UNIQUE,
  source_physical_version INTEGER NOT NULL,
  target_physical_version INTEGER NOT NULL,
  source_document_version INTEGER NOT NULL,
  target_document_version INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  backup_path TEXT NOT NULL,
  backup_sha256 TEXT NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE TABLE plugin_migration_runs (
  plugin_id TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  from_schema_version INTEGER NOT NULL,
  to_schema_version INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  PRIMARY KEY (plugin_id, migration_id)
);

CREATE TABLE plugin_kv (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

${MACRO_STORAGE_SCHEMA_SQL}
`;
