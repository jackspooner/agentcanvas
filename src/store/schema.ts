export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS canvases (
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
  background_json TEXT,
  elements_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS canvas_events (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT,
  FOREIGN KEY (canvas_id) REFERENCES canvases(id)
);

CREATE TABLE IF NOT EXISTS canvas_share_links (
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

CREATE TABLE IF NOT EXISTS canvas_idempotency_keys (
  key TEXT PRIMARY KEY,
  canvas_id TEXT,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canvas_viewports (
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
`;
