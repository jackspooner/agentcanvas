import type { DatabaseSync } from 'node:sqlite';
import type { JsonValue, NamespacedPluginKv, PluginDiagnostic, PluginDiagnostics } from '@agentcanvas/plugin-sdk';
import { isJsonValue } from '@agentcanvas/plugin-sdk';
import type { PluginRuntimeServices } from './registry.js';

const SAFE_KV_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;

function validateKey(key: string): string {
  if (!SAFE_KV_KEY.test(key)) throw new Error('plugin KV key must be a safe non-empty string');
  return key;
}

class SqlitePluginKv implements NamespacedPluginKv {
  constructor(
    private readonly db: DatabaseSync,
    private readonly pluginId: string
  ) {}

  async get(key: string): Promise<JsonValue | undefined> {
    const row = this.db
      .prepare('SELECT value_json FROM plugin_kv WHERE plugin_id = ? AND key = ?')
      .get(this.pluginId, validateKey(key)) as { value_json: string } | undefined;
    if (!row) return undefined;
    const value = JSON.parse(row.value_json) as unknown;
    if (!isJsonValue(value)) throw new Error(`plugin KV contains invalid JSON for ${this.pluginId}/${key}`);
    return value;
  }

  async set(key: string, value: JsonValue): Promise<void> {
    if (!isJsonValue(value)) throw new Error('plugin KV values must be finite JSON values');
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) throw new Error('plugin KV value exceeds 256 KiB');
    this.db
      .prepare(`INSERT INTO plugin_kv (plugin_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(plugin_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
      .run(this.pluginId, validateKey(key), serialized, new Date().toISOString());
  }

  async delete(key: string): Promise<boolean> {
    return (
      this.db.prepare('DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?').run(this.pluginId, validateKey(key))
        .changes > 0
    );
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}): Promise<{
    entries: readonly { key: string; value: JsonValue }[];
    nextCursor?: string;
  }> {
    const prefix = options.prefix ?? '';
    const cursor = options.cursor ?? '';
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const rows = this.db
      .prepare(`SELECT key, value_json FROM plugin_kv
        WHERE plugin_id = ? AND key LIKE ? ESCAPE '\\' AND key > ?
        ORDER BY key LIMIT ?`)
      .all(this.pluginId, `${prefix.replace(/[\\%_]/g, '\\$&')}%`, cursor, limit + 1) as unknown as Array<{
      key: string;
      value_json: string;
    }>;
    const page = rows.slice(0, limit).map((row) => {
      const value = JSON.parse(row.value_json) as unknown;
      if (!isJsonValue(value)) throw new Error(`plugin KV contains invalid JSON for ${this.pluginId}/${row.key}`);
      return { key: row.key, value };
    });
    return {
      entries: page,
      ...(rows.length > limit && page.length ? { nextCursor: page[page.length - 1].key } : {})
    };
  }
}

class DeferredPluginKv implements NamespacedPluginKv {
  constructor(
    private readonly database: () => DatabaseSync | null,
    private readonly pluginId: string
  ) {}

  private current(): SqlitePluginKv {
    const db = this.database();
    if (!db) throw new Error(`plugin KV is unavailable before database binding: ${this.pluginId}`);
    return new SqlitePluginKv(db, this.pluginId);
  }

  async get(key: string): Promise<JsonValue | undefined> {
    return this.current().get(key);
  }

  async set(key: string, value: JsonValue): Promise<void> {
    return this.current().set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.current().delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    return this.current().list(options);
  }
}

export class RuntimePluginDiagnostics {
  private readonly values: PluginDiagnostic[] = [];

  scoped(pluginId: string): PluginDiagnostics {
    return {
      emit: (diagnostic) => {
        this.values.push(Object.freeze({ ...diagnostic, pluginId }));
      }
    };
  }

  list(): readonly PluginDiagnostic[] {
    return Object.freeze(this.values.map((value) => Object.freeze({ ...value })));
  }
}

export function createPluginRuntimeServices(
  db: DatabaseSync,
  diagnostics = new RuntimePluginDiagnostics()
): PluginRuntimeServices & { diagnosticsStore: RuntimePluginDiagnostics } {
  return {
    diagnosticsStore: diagnostics,
    kv: (pluginId) => new SqlitePluginKv(db, pluginId),
    diagnostics: (pluginId) => diagnostics.scoped(pluginId)
  };
}

export function createDeferredPluginRuntimeServices(
  diagnostics = new RuntimePluginDiagnostics()
): PluginRuntimeServices & {
  diagnosticsStore: RuntimePluginDiagnostics;
  bindDatabase(db: DatabaseSync): void;
} {
  let database: DatabaseSync | null = null;
  return {
    diagnosticsStore: diagnostics,
    bindDatabase: (db) => {
      if (database) throw new Error('plugin runtime database is already bound');
      database = db;
    },
    kv: (pluginId) => new DeferredPluginKv(() => database, pluginId),
    diagnostics: (pluginId) => diagnostics.scoped(pluginId)
  };
}
