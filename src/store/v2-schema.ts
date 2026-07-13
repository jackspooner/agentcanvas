export const PHYSICAL_SCHEMA_VERSION = 2;
export const DOCUMENT_SCHEMA_VERSION = 2;

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
`;
