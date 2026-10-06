import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { V1_SCHEMA_SQL } from '../src/migrations/v1-schema';
import { initializeEmptyV2Database, inspectDatabaseVersion, requireV2Database } from '../src/store/version';

describe('database version contract', () => {
  it('creates a complete v0.2 schema transactionally for an empty database', () => {
    const db = new DatabaseSync(':memory:');
    initializeEmptyV2Database(db, '0.2.0', '2026-07-13T00:00:00.000Z');
    expect(inspectDatabaseVersion(db)).toEqual({ kind: 'v2', physicalVersion: 5, documentVersion: 2 });
    expect(
      db.prepare('SELECT physical_version, document_version FROM agent_canvas_installation_metadata').get()
    ).toEqual({
      physical_version: 5,
      document_version: 2
    });
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(5);
    db.close();
  });

  it('classifies the legacy schema and gives the exact migration action', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(V1_SCHEMA_SQL);
    expect(inspectDatabaseVersion(db)).toEqual({ kind: 'v1', physicalVersion: 0, documentVersion: 1 });
    expect(() => requireV2Database(db)).toThrowError(/agentcanvas migrate apply --database <path>/);
    db.close();
  });

  it('rejects contradictory physical and metadata versions', () => {
    const db = new DatabaseSync(':memory:');
    initializeEmptyV2Database(db, '0.2.0');
    db.exec('PRAGMA user_version = 1;');
    expect(inspectDatabaseVersion(db)).toMatchObject({ kind: 'contradictory' });
    expect(() => requireV2Database(db)).toThrowError(/disagrees/);
    db.close();
  });
});
