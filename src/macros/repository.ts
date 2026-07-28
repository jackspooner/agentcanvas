import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { canonicalJson, sha256 } from './canonical-json.js';
import { validateMacroDefinition } from './definition.js';
import { MacroError } from './errors.js';
import type {
  MacroArchiveResponse,
  MacroCanvasSnapshot,
  MacroCreateVersionInput,
  MacroDefinitionAuthoringV1,
  MacroDefinitionRecord,
  MacroDefinitionV1,
  MacroEffectSummary,
  MacroHistory,
  MacroProvenance,
  MacroListRequest,
  MacroListResponse,
  MacroRepository
} from './types.js';

interface MacroDefinitionRow {
  id: string;
  scope_kind: 'installation' | 'canvas';
  canvas_id: string | null;
  current_version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MacroVersionRow {
  macro_id: string;
  version: number;
  definition_json: string;
  definition_sha256: string;
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseDefinition(row: MacroVersionRow, owner: MacroDefinitionRow): MacroDefinitionV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(row.definition_json);
  } catch (error) {
    throw new MacroError(
      'macro_definition_invalid',
      `stored macro ${row.macro_id}/${row.version} is not valid JSON`,
      'repository',
      { status: 500 }
    );
  }
  const definition = validateMacroDefinition(raw);
  if (
    definition.id !== row.macro_id ||
    definition.version !== row.version ||
    definition.scope !== owner.scope_kind ||
    (definition.scope === 'canvas' ? definition.canvasId !== owner.canvas_id : owner.canvas_id !== null) ||
    sha256(definition) !== row.definition_sha256
  ) {
    throw new MacroError(
      'macro_definition_invalid',
      `stored macro ${row.macro_id}/${row.version} is inconsistent`,
      'repository',
      { status: 500 }
    );
  }
  return definition;
}

function recordFromRows(owner: MacroDefinitionRow, version: MacroVersionRow): MacroDefinitionRecord {
  return {
    definition: parseDefinition(version, owner),
    currentVersion: owner.current_version,
    archived: owner.archived_at !== null
  };
}

function validateAuthoring(value: unknown): MacroDefinitionAuthoringV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MacroError('macro_definition_invalid', 'macro authoring input must be an object', 'definition');
  }
  const raw = value as Record<string, unknown>;
  if (Object.hasOwn(raw, 'id') || Object.hasOwn(raw, 'version')) {
    throw new MacroError(
      'macro_definition_invalid',
      'macro authoring input cannot contain host-assigned fields',
      'definition'
    );
  }
  const { macroId: _macroId, expectedCurrentVersion: _expectedCurrentVersion, ...authoring } = raw;
  return clone(authoring as MacroDefinitionAuthoringV1);
}

function begin(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE;');
}

function rollback(db: DatabaseSync): void {
  db.exec('ROLLBACK;');
}

function withTransaction<T>(db: DatabaseSync, callback: () => T): T {
  begin(db);
  try {
    const result = callback();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    rollback(db);
    throw error;
  }
}

export class SqliteMacroRepository implements MacroRepository {
  constructor(
    readonly db: DatabaseSync,
    private readonly getCanvasRecord: (canvasId: string) => MacroCanvasSnapshot
  ) {}

  getCanvas(canvasId: string): MacroCanvasSnapshot {
    return this.getCanvasRecord(canvasId);
  }

  create(input: MacroDefinitionAuthoringV1): MacroDefinitionRecord {
    const authoring = validateAuthoring(input);
    const id = `macro_${nanoid(24)}`;
    return withTransaction(this.db, () => {
      const definition = validateMacroDefinition({ ...authoring, id, version: 1 });
      this.assertScopeCanvas(definition.scope, definition.canvasId);
      const createdAt = now();
      this.db
        .prepare(`INSERT INTO macro_definitions
          (id,scope_kind,canvas_id,current_version,archived_at,created_at,updated_at)
          VALUES (?,?,?,?,NULL,?,?)`)
        .run(id, definition.scope, definition.canvasId ?? null, 1, createdAt, createdAt);
      this.insertVersion(definition, createdAt);
      return { definition, currentVersion: 1, archived: false };
    });
  }

  createVersion(input: MacroCreateVersionInput): MacroDefinitionRecord {
    const authoring = validateAuthoring(input);
    if (typeof input.macroId !== 'string' || input.macroId.length === 0) {
      throw new MacroError('macro_definition_invalid', 'macroId is required', 'repository');
    }
    return withTransaction(this.db, () => {
      const owner = this.owner(input.macroId);
      if (!owner)
        throw new MacroError('macro_not_found', 'macro definition was not found', 'repository', { status: 404 });
      if (input.expectedCurrentVersion !== undefined && input.expectedCurrentVersion !== owner.current_version) {
        throw new MacroError('macro_version_mismatch', 'current macro version changed', 'repository', {
          status: 409,
          retryable: true
        });
      }
      const version = owner.current_version + 1;
      const definition = validateMacroDefinition({ ...authoring, id: owner.id, version });
      if (
        definition.scope !== owner.scope_kind ||
        (definition.scope === 'canvas' ? definition.canvasId !== owner.canvas_id : owner.canvas_id !== null)
      ) {
        throw new MacroError(
          'macro_scope_denied',
          'macro scope and canvas identity cannot change across versions',
          'repository',
          { status: 409 }
        );
      }
      this.assertScopeCanvas(definition.scope, definition.canvasId);
      const updatedAt = now();
      this.insertVersion(definition, updatedAt);
      this.db
        .prepare('UPDATE macro_definitions SET current_version=?,updated_at=? WHERE id=?')
        .run(version, updatedAt, owner.id);
      const updatedOwner = { ...owner, current_version: version, updated_at: updatedAt };
      return { definition, currentVersion: version, archived: updatedOwner.archived_at !== null };
    });
  }

  getDefinition(id: string, version: number, canvasId: string): MacroDefinitionRecord | undefined {
    const owner = this.owner(id);
    if (!owner || !this.isVisible(owner, canvasId)) return undefined;
    const row = this.db
      .prepare('SELECT * FROM macro_versions WHERE macro_id=? AND version=?')
      .get(id, version) as unknown as MacroVersionRow | undefined;
    return row ? recordFromRows(owner, row) : undefined;
  }

  hasMacro(id: string, canvasId: string): boolean {
    const owner = this.owner(id);
    return owner !== undefined && this.isVisible(owner, canvasId);
  }

  list(input: MacroListRequest = {}): MacroListResponse {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const includeArchived = input.includeArchived === true;
    const cursor = decodeCursor(input.cursor, input.canvasId, includeArchived);
    const rows = this.db
      .prepare(`SELECT * FROM macro_definitions
      WHERE (? = 1 OR archived_at IS NULL)
        AND (scope_kind = 'installation' OR (scope_kind = 'canvas' AND canvas_id = ?))
        AND id > ?
      ORDER BY id COLLATE BINARY LIMIT ?`)
      .all(includeArchived ? 1 : 0, input.canvasId ?? null, cursor, limit + 1) as unknown as MacroDefinitionRow[];
    const page = rows.slice(0, limit).map((owner) => {
      const version = this.db
        .prepare('SELECT * FROM macro_versions WHERE macro_id=? AND version=?')
        .get(owner.id, owner.current_version) as unknown as MacroVersionRow | undefined;
      if (!version)
        throw new MacroError(
          'macro_definition_invalid',
          `current macro version is missing for ${owner.id}`,
          'repository',
          { status: 500 }
        );
      const definition = parseDefinition(version, owner);
      return {
        id: definition.id,
        scope: definition.scope,
        ...(definition.canvasId ? { canvasId: definition.canvasId } : {}),
        currentVersion: owner.current_version,
        archived: owner.archived_at !== null,
        title: definition.title,
        ...(definition.description !== undefined ? { description: definition.description } : {}),
        ...(definition.category !== undefined ? { category: definition.category } : {}),
        createdAt: owner.created_at,
        updatedAt: owner.updated_at
      };
    });
    return {
      items: page,
      ...(rows.length > limit && page.length
        ? { nextCursor: encodeCursor(page[page.length - 1].id, input.canvasId, includeArchived) }
        : {})
    };
  }

  archive(id: string, archived: boolean): MacroArchiveResponse {
    return withTransaction(this.db, () => {
      const owner = this.owner(id);
      if (!owner)
        throw new MacroError('macro_not_found', 'macro definition was not found', 'repository', { status: 404 });
      const updatedAt = now();
      this.db
        .prepare('UPDATE macro_definitions SET archived_at=?,updated_at=? WHERE id=?')
        .run(archived ? updatedAt : null, updatedAt, id);
      return { macroId: id, currentVersion: owner.current_version, archived };
    });
  }

  recordInvocation(
    db: DatabaseSync,
    input: {
      canvasId: string;
      resultingRevision: number;
      idempotencyKey: string;
      provenance: MacroProvenance;
      outputs: Readonly<Record<string, string>>;
      effectSummary: MacroEffectSummary;
      history: MacroHistory;
    }
  ): void {
    db.prepare(`INSERT INTO macro_invocations
      (id,canvas_id,resulting_revision,macro_id,macro_version,plan_sha256,input_sha256,safe_summary_json,outputs_json,idempotency_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      `macro_invocation_${nanoid(20)}`,
      input.canvasId,
      input.resultingRevision,
      input.provenance.macroId,
      input.provenance.macroVersion,
      input.provenance.planDigest,
      input.provenance.inputDigest,
      canonicalJson({
        operationCount: input.effectSummary.operationCount,
        generatedElementCount: input.effectSummary.generatedElementCount,
        affectedElementIds: [...input.effectSummary.affectedElementIds].slice(0, 100)
      }),
      canonicalJson(input.outputs),
      input.idempotencyKey,
      now()
    );
  }

  private owner(id: string): MacroDefinitionRow | undefined {
    return this.db.prepare('SELECT * FROM macro_definitions WHERE id=?').get(id) as unknown as
      | MacroDefinitionRow
      | undefined;
  }

  private isVisible(owner: MacroDefinitionRow, canvasId: string): boolean {
    return owner.scope_kind === 'installation' || owner.canvas_id === canvasId;
  }

  private assertScopeCanvas(scope: MacroDefinitionV1['scope'], canvasId: string | undefined): void {
    if (scope === 'canvas') this.getCanvasRecord(canvasId as string);
  }

  private insertVersion(definition: MacroDefinitionV1, createdAt: string): void {
    this.db
      .prepare(`INSERT INTO macro_versions
      (macro_id,version,definition_json,definition_sha256,created_at) VALUES (?,?,?,?,?)`)
      .run(definition.id, definition.version, canonicalJson(definition), sha256(definition), createdAt);
  }
}

function encodeCursor(id: string, canvasId: string | undefined, includeArchived: boolean): string {
  return Buffer.from(JSON.stringify({ id, canvasId: canvasId ?? null, includeArchived }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined, canvasId: string | undefined, includeArchived: boolean): string {
  if (!value) return '';
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      canvasId?: unknown;
      includeArchived?: unknown;
    };
    if (
      typeof parsed.id !== 'string' ||
      (parsed.canvasId ?? null) !== (canvasId ?? null) ||
      parsed.includeArchived !== includeArchived
    )
      throw new Error('cursor filters changed');
    return parsed.id;
  } catch (error) {
    throw new MacroError('macro_definition_invalid', 'macro cursor is invalid', 'repository');
  }
}
