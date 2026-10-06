import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CanvasElement, CanvasThemeV1, JsonObject } from '@agentcanvas/plugin-sdk';
import { isJsonObject } from '@agentcanvas/plugin-sdk';
import { nanoid } from 'nanoid';
import { canvasShareUrl } from '../canvas-url.js';
import { type AgentCanvasConfig, loadConfig } from '../config.js';
import {
  type AgentCanvasConfiguration,
  normalizeConfigurationUpdate,
  type UpdateAgentCanvasConfigurationInput
} from '../configuration.js';
import type {
  CanvasBounds,
  CanvasViewport,
  CanvasViewportInput,
  CanvasViewportState,
  CreateCanvasInput,
  CreateShareLinkInput,
  RenameCanvasInput,
  ShareLinkRecord,
  UpdateCanvasBoundsInput,
  UpdateCanvasThemeInput
} from '../contracts.js';
import { CANVAS_LIST_LIMITS, DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from '../contracts.js';
import { CanvasError } from '../errors.js';
import type { PluginElementValidator } from '../plugin-runtime/elements.js';
import { normalizeCanvasTheme } from '../theme.js';
import {
  defaultViewport,
  elementFitsCanvasBounds,
  normalizeCanvasBounds,
  normalizeViewportInput,
  validateSafeId
} from '../validation.js';
import { AGENTCANVAS_VERSION } from '../version.js';
import { readAgentCanvasConfiguration, writeAgentCanvasConfiguration } from './configuration.js';
import { initializeEmptyV2Database, inspectDatabaseVersion, requireV2Database } from './version.js';

export type {
  CanvasBatchRequest as V2CanvasBatchRequest,
  CanvasOperation as V2CanvasOperation,
  CanvasRecord as V2CanvasRecord
} from '@agentcanvas/core';

import type { CanvasBatchRequest as V2CanvasBatchRequest, CanvasRecord as V2CanvasRecord } from '@agentcanvas/core';

export interface V2BatchTransactionContext {
  db: DatabaseSync;
  canvas: V2CanvasRecord;
  response: V2CanvasRecord;
  revision: number;
  updatedAt: string;
  requestDigest: string;
  normalizedOperations: readonly JsonObject[];
  actor?: string;
}

export type V2BatchTransactionCallback<TResponse> = (context: V2BatchTransactionContext) => TResponse;

export interface V2BatchTransactionOptions {
  idempotencyRequestDigest?: string;
}

interface CanvasRow {
  id: string;
  title: string;
  description: string | null;
  project: string | null;
  conversation_id: string | null;
  created_by: V2CanvasRecord['createdBy'];
  created_at: string;
  updated_at: string;
  width: number;
  height: number;
  bounds_json: string | null;
  background_json: string | null;
  theme_json: string | null;
  elements_json: string;
  revision: number;
  metadata_json: string | null;
  document_version: number;
}

interface ShareRow {
  id: string;
  canvas_id: string;
  mode: 'read';
  label: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface ViewportRow {
  source: 'user' | 'agent';
  center_x: number;
  center_y: number;
  zoom: number;
  width: number;
  height: number;
  updated_at: string;
}

function serialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parse<T>(value: string | null, fallback: T): T {
  return value ? (JSON.parse(value) as T) : fallback;
}

function timestamp(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateIdempotencyRequestDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/.test(value)) {
    throw new CanvasError(
      'validation_error',
      'idempotencyRequestDigest must be a 64-character lowercase SHA-256 hex string',
      'validation',
      400
    );
  }
}

function checkRevision(expected: number | undefined, current: number): void {
  if (expected !== undefined && expected !== current) {
    throw new CanvasError(
      'revision_conflict',
      `expected revision ${expected}, current revision ${current}`,
      'revision',
      409,
      true
    );
  }
}

function validateElementBounds(element: CanvasElement, bounds: CanvasBounds): void {
  if (!elementFitsCanvasBounds(element, bounds)) {
    throw new CanvasError(
      'validation_error',
      `element ${element.id} does not fit within the canvas bounds`,
      'validation',
      400
    );
  }
}

function shareFromRow(row: ShareRow): ShareLinkRecord {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    mode: row.mode,
    label: row.label,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at
  };
}

/** Exact-version v0.2 store. It never upgrades or repairs a pre-existing database during startup. */
export class V2SqliteCanvasStore {
  readonly db: DatabaseSync;
  readonly config: AgentCanvasConfig;

  constructor(
    readonly elementValidator: PluginElementValidator,
    databasePath?: string,
    config: Partial<AgentCanvasConfig> = {},
    toolVersion = AGENTCANVAS_VERSION
  ) {
    this.config = loadConfig({ ...config, databasePath: databasePath ?? config.databasePath });
    if (this.config.databasePath !== ':memory:')
      fs.mkdirSync(path.dirname(this.config.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.config.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (inspectDatabaseVersion(this.db).kind === 'empty') initializeEmptyV2Database(this.db, toolVersion);
    requireV2Database(this.db);
  }

  close(): void {
    this.db.close();
  }

  createCanvas(input: CreateCanvasInput): V2CanvasRecord {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) throw new CanvasError('validation_error', 'canvas title is required', 'validation', 400);
    const createdAt = timestamp();
    const hasLegacySize = input.width !== undefined || input.height !== undefined;
    const requestedBounds =
      input.bounds !== undefined ? input.bounds : hasLegacySize ? undefined : this.getConfiguration().defaultCanvasSize;
    const bounds = normalizeCanvasBounds(requestedBounds, { width: input.width, height: input.height });
    const storageWidth = bounds.mode === 'fixed' ? bounds.width : DEFAULT_CANVAS_WIDTH;
    const storageHeight = bounds.mode === 'fixed' ? bounds.height : DEFAULT_CANVAS_HEIGHT;
    const metadata = input.metadata ?? {};
    if (!isJsonObject(metadata))
      throw new CanvasError('validation_error', 'canvas metadata must be JSON', 'validation', 400);
    const theme = input.theme === undefined || input.theme === null ? null : normalizeCanvasTheme(input.theme);
    const canvas: V2CanvasRecord = {
      id: `canvas_${nanoid(12)}`,
      title,
      description: input.description ?? null,
      project: input.project ?? null,
      conversationId: input.conversationId ?? null,
      createdBy: input.createdBy ?? 'agent',
      createdAt,
      updatedAt: createdAt,
      bounds,
      ...(bounds.mode === 'fixed' ? { width: bounds.width, height: bounds.height } : {}),
      background: input.background ?? null,
      theme,
      elements: [],
      revision: 1,
      metadata: structuredClone(metadata) as JsonObject,
      documentVersion: 2
    };
    this.db
      .prepare(`INSERT INTO canvases
        (id,title,description,project,conversation_id,created_by,created_at,updated_at,width,height,bounds_json,
         background_json,theme_json,elements_json,revision,metadata_json,document_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,2)`)
      .run(
        canvas.id,
        canvas.title,
        canvas.description ?? null,
        canvas.project ?? null,
        canvas.conversationId ?? null,
        canvas.createdBy,
        canvas.createdAt,
        canvas.updatedAt,
        storageWidth,
        storageHeight,
        serialize(bounds),
        serialize(canvas.background),
        serialize(canvas.theme),
        '[]',
        1,
        serialize(canvas.metadata)
      );
    return canvas;
  }

  listCanvases(filter: { project?: string; conversationId?: string; limit?: number } = {}): V2CanvasRecord[] {
    const limit = filter.limit === undefined ? CANVAS_LIST_LIMITS.default : filter.limit;
    if (!Number.isSafeInteger(limit) || limit < CANVAS_LIST_LIMITS.minimum || limit > CANVAS_LIST_LIMITS.maximum) {
      throw new CanvasError(
        'validation_error',
        `limit must be an integer between ${CANVAS_LIST_LIMITS.minimum} and ${CANVAS_LIST_LIMITS.maximum}`,
        'validation',
        400
      );
    }
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.project) {
      clauses.push('project = ?');
      parameters.push(filter.project);
    }
    if (filter.conversationId) {
      clauses.push('conversation_id = ?');
      parameters.push(filter.conversationId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM canvases ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...parameters, limit) as unknown as CanvasRow[];
    return rows.map((row) => this.fromRow(row));
  }

  getCanvas(id: string): V2CanvasRecord {
    const row = this.db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as unknown as CanvasRow | undefined;
    if (!row) throw new CanvasError('not_found', `canvas not found: ${id}`, 'not_found', 404);
    return this.fromRow(row);
  }

  getConfiguration(): AgentCanvasConfiguration {
    return readAgentCanvasConfiguration(this.db, this.config.defaultCanvasSize);
  }

  deleteCanvas(canvasId: string, expectedRevision?: number): { canvasId: string; deleted: true } {
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw new CanvasError('validation_error', 'expectedRevision must be a positive integer', 'validation', 400);
    }
    return this.metadataTransaction(() => {
      const canvas = this.db.prepare('SELECT revision FROM canvases WHERE id=?').get(canvasId) as
        | { revision: number }
        | undefined;
      if (!canvas) throw new CanvasError('not_found', `canvas not found: ${canvasId}`, 'not_found', 404);
      checkRevision(expectedRevision, canvas.revision);
      const macros = this.db
        .prepare('SELECT id FROM macro_definitions WHERE canvas_id=?')
        .all(canvasId) as unknown as Array<{ id: string }>;
      // Versions remain immutable while their parent exists; validate deferred references at commit.
      this.db.exec('PRAGMA defer_foreign_keys = ON;');
      this.db.prepare('DELETE FROM macro_invocations WHERE canvas_id=?').run(canvasId);
      this.db.prepare('DELETE FROM macro_definitions WHERE canvas_id=?').run(canvasId);
      const deleteVersions = this.db.prepare('DELETE FROM macro_versions WHERE macro_id=?');
      for (const macro of macros) deleteVersions.run(macro.id);
      for (const table of ['canvas_events', 'canvas_share_links', 'canvas_idempotency_keys', 'canvas_viewports']) {
        this.db.prepare(`DELETE FROM ${table} WHERE canvas_id=?`).run(canvasId);
      }
      this.db.prepare('DELETE FROM canvases WHERE id=?').run(canvasId);
      return { canvasId, deleted: true as const };
    });
  }

  updateConfiguration(input: UpdateAgentCanvasConfigurationInput | Record<string, unknown>): AgentCanvasConfiguration {
    return writeAgentCanvasConfiguration(this.db, normalizeConfigurationUpdate(input), this.config.defaultCanvasSize);
  }

  updateCanvasBounds(canvasId: string, input: UpdateCanvasBoundsInput): V2CanvasRecord {
    return this.metadataTransaction(() => {
      const canvas = this.getCanvas(canvasId);
      if (!input || input.bounds === undefined) {
        throw new CanvasError('validation_error', 'canvas bounds are required', 'validation', 400);
      }
      checkRevision(input.expectedRevision, canvas.revision);
      const bounds = normalizeCanvasBounds(input.bounds);
      for (const element of canvas.elements) validateElementBounds(element, bounds);
      const revision = canvas.revision + 1;
      const updatedAt = timestamp();
      this.db
        .prepare('UPDATE canvases SET width=?, height=?, bounds_json=?, revision=?, updated_at=? WHERE id=?')
        .run(
          bounds.mode === 'fixed' ? bounds.width : DEFAULT_CANVAS_WIDTH,
          bounds.mode === 'fixed' ? bounds.height : DEFAULT_CANVAS_HEIGHT,
          serialize(bounds),
          revision,
          updatedAt,
          canvasId
        );
      this.recordEvent(canvasId, revision, { op: 'setBounds', bounds }, updatedAt, input.actor);
      return {
        ...canvas,
        bounds,
        ...(bounds.mode === 'fixed'
          ? { width: bounds.width, height: bounds.height }
          : { width: undefined, height: undefined }),
        revision,
        updatedAt
      };
    });
  }

  renameCanvas(canvasId: string, input: RenameCanvasInput): V2CanvasRecord {
    return this.metadataTransaction(() => {
      const canvas = this.getCanvas(canvasId);
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      if (!title) throw new CanvasError('validation_error', 'canvas title is required', 'validation', 400);
      checkRevision(input.expectedRevision, canvas.revision);
      if (title === canvas.title) return canvas;
      const revision = canvas.revision + 1;
      const updatedAt = timestamp();
      this.db
        .prepare('UPDATE canvases SET title=?, revision=?, updated_at=? WHERE id=?')
        .run(title, revision, updatedAt, canvasId);
      this.recordEvent(canvasId, revision, { op: 'renameCanvas', title }, updatedAt, input.actor);
      return { ...canvas, title, revision, updatedAt };
    });
  }

  updateCanvasTheme(canvasId: string, input: UpdateCanvasThemeInput): V2CanvasRecord {
    return this.metadataTransaction(() => {
      const canvas = this.getCanvas(canvasId);
      if (!input || !Object.hasOwn(input, 'theme')) {
        throw new CanvasError('validation_error', 'canvas theme is required and may be null', 'validation', 400);
      }
      checkRevision(input.expectedRevision, canvas.revision);
      const theme = input.theme === null ? null : normalizeCanvasTheme(input.theme);
      if (JSON.stringify(theme) === JSON.stringify(canvas.theme ?? null)) return canvas;
      const revision = canvas.revision + 1;
      const updatedAt = timestamp();
      this.db
        .prepare('UPDATE canvases SET theme_json=?, revision=?, updated_at=? WHERE id=?')
        .run(serialize(theme), revision, updatedAt, canvasId);
      this.recordEvent(
        canvasId,
        revision,
        { op: 'setTheme', theme: theme as unknown as JsonObject | null },
        updatedAt,
        input.actor
      );
      return { ...canvas, theme, revision, updatedAt };
    });
  }

  private metadataTransaction<T>(update: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const canvas = update();
      this.db.exec('COMMIT;');
      return canvas;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  applyOperations(canvasId: string, request: V2CanvasBatchRequest): V2CanvasRecord {
    return this.applyOperationsWithTransaction(canvasId, request);
  }

  /** Applies an element batch and lets a caller add transaction-local state before the commit. */
  applyOperationsWithTransaction<TResponse = V2CanvasRecord>(
    canvasId: string,
    request: V2CanvasBatchRequest,
    callback?: V2BatchTransactionCallback<TResponse>,
    options: V2BatchTransactionOptions = {}
  ): TResponse {
    if (!Array.isArray(request.operations)) {
      throw new CanvasError('validation_error', 'operations must be an array', 'validation', 400);
    }
    const ordinaryRequestDigest = sha256(
      serialize({
        canvasId,
        documentVersion: 2,
        operations: request.operations,
        expectedRevision: request.expectedRevision
      })
    );
    if (options.idempotencyRequestDigest !== undefined)
      validateIdempotencyRequestDigest(options.idempotencyRequestDigest);
    const requestDigest = options.idempotencyRequestDigest ?? ordinaryRequestDigest;
    const cached = this.readCachedBatchResponse(canvasId, request.idempotencyKey, requestDigest);
    if (cached !== null) return JSON.parse(cached) as TResponse;

    // All request validation and element normalization happen before the write transaction.
    const prepared = this.prepareOperations(canvasId, request);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const transactionCached = this.readCachedBatchResponse(canvasId, request.idempotencyKey, requestDigest);
      if (transactionCached !== null) {
        this.db.exec('COMMIT;');
        return JSON.parse(transactionCached) as TResponse;
      }
      const response = {
        ...prepared.canvas,
        elements: prepared.elements,
        revision: prepared.revision,
        updatedAt: prepared.updatedAt
      };
      this.db
        .prepare('UPDATE canvases SET elements_json=?,revision=?,updated_at=? WHERE id=?')
        .run(serialize(prepared.elements), prepared.revision, prepared.updatedAt, canvasId);
      for (const operation of prepared.normalizedOperations)
        this.recordEvent(canvasId, prepared.revision, operation, prepared.updatedAt, request.actor);
      const shapedResponse: TResponse = callback
        ? callback({
            db: this.db,
            canvas: prepared.canvas,
            response,
            revision: prepared.revision,
            updatedAt: prepared.updatedAt,
            requestDigest,
            normalizedOperations: prepared.normalizedOperations,
            ...(request.actor !== undefined ? { actor: request.actor } : {})
          })
        : (response as unknown as TResponse);
      if (request.idempotencyKey) {
        this.db
          .prepare(`INSERT INTO canvas_idempotency_keys
            (canvas_id,document_version,key,request_hash,response_json,created_at) VALUES (?,2,?,?,?,?)`)
          .run(canvasId, request.idempotencyKey, requestDigest, serialize(shapedResponse), timestamp());
      }
      this.db.exec('COMMIT;');
      return shapedResponse;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  /** Reads only a previously committed macro result, allowing replay after the in-memory plan has expired. */
  getCachedMacroResponse(
    canvasId: string,
    idempotencyKey: string,
    planId: string,
    expectedRevision: number,
    requestDigest?: string
  ): unknown | undefined {
    const row = this.db
      .prepare('SELECT response_json FROM canvas_idempotency_keys WHERE canvas_id=? AND document_version=2 AND key=?')
      .get(canvasId, idempotencyKey) as { response_json: string } | undefined;
    if (!row) return undefined;
    if (requestDigest !== undefined) {
      const cached = JSON.parse(row.response_json) as {
        canvas?: { revision?: unknown };
        provenance?: { planId?: unknown };
      };
      const hash = this.db
        .prepare('SELECT request_hash FROM canvas_idempotency_keys WHERE canvas_id=? AND document_version=2 AND key=?')
        .get(canvasId, idempotencyKey) as { request_hash: string } | undefined;
      if (!hash || hash.request_hash !== requestDigest) {
        throw new CanvasError(
          'idempotency_conflict',
          'idempotency key was reused with a different macro request',
          'idempotency',
          409
        );
      }
      if (!cached.provenance) return undefined;
      return cached;
    }
    const response = JSON.parse(row.response_json) as {
      canvas?: { revision?: unknown };
      provenance?: { planId?: unknown };
    };
    if (
      response.provenance &&
      (response.provenance.planId !== planId || response.canvas?.revision !== expectedRevision + 1)
    ) {
      throw new CanvasError(
        'idempotency_conflict',
        'idempotency key was reused with a different macro request',
        'idempotency',
        409
      );
    }
    if (!response.provenance) return undefined;
    return response;
  }

  createShareLink(
    canvasId: string,
    input: CreateShareLinkInput = {}
  ): ShareLinkRecord & { token: string; url: string } {
    this.getCanvas(canvasId);
    if (input.expiresAt != null && !Number.isFinite(Date.parse(input.expiresAt))) {
      throw new CanvasError('validation_error', 'share link expiresAt must be a valid date-time', 'validation', 400);
    }
    const token = `share_${nanoid(24)}`;
    const createdAt = timestamp();
    const link: ShareLinkRecord = {
      id: `link_${nanoid(12)}`,
      canvasId,
      mode: 'read',
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt,
      revokedAt: null
    };
    this.db
      .prepare(`INSERT INTO canvas_share_links
        (id,canvas_id,token_hash,mode,label,expires_at,created_at,revoked_at) VALUES (?,?,?,?,?,?,?,NULL)`)
      .run(link.id, canvasId, sha256(token), 'read', link.label ?? null, link.expiresAt ?? null, createdAt);
    return { ...link, token, url: canvasShareUrl(this.config.publicBaseUrl, token) };
  }

  resolveShareToken(token: string): { link: ShareLinkRecord; canvas: V2CanvasRecord } {
    const row = this.db
      .prepare('SELECT * FROM canvas_share_links WHERE token_hash=? AND revoked_at IS NULL')
      .get(sha256(token)) as unknown as ShareRow | undefined;
    if (!row) throw new CanvasError('not_found', 'share link not found', 'not_found', 404);
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
      throw new CanvasError('permission_denied', 'share link expired', 'permission', 403);
    }
    return { link: shareFromRow(row), canvas: this.getCanvas(row.canvas_id) };
  }

  listShareLinks(canvasId: string): ShareLinkRecord[] {
    this.getCanvas(canvasId);
    return (
      this.db
        .prepare('SELECT * FROM canvas_share_links WHERE canvas_id=? ORDER BY created_at DESC')
        .all(canvasId) as unknown as ShareRow[]
    ).map(shareFromRow);
  }

  revokeShareLink(canvasId: string, shareLinkId: string): ShareLinkRecord {
    this.getCanvas(canvasId);
    const row = this.db
      .prepare('SELECT * FROM canvas_share_links WHERE canvas_id=? AND id=?')
      .get(canvasId, shareLinkId) as unknown as ShareRow | undefined;
    if (!row) throw new CanvasError('not_found', `share link not found: ${shareLinkId}`, 'not_found', 404);
    if (!row.revoked_at) {
      this.db
        .prepare('UPDATE canvas_share_links SET revoked_at=? WHERE canvas_id=? AND id=?')
        .run(timestamp(), canvasId, shareLinkId);
    }
    return shareFromRow(
      this.db
        .prepare('SELECT * FROM canvas_share_links WHERE canvas_id=? AND id=?')
        .get(canvasId, shareLinkId) as unknown as ShareRow
    );
  }

  getViewportState(canvasId: string): CanvasViewportState {
    const canvas = this.getCanvas(canvasId);
    const rows = this.db
      .prepare('SELECT * FROM canvas_viewports WHERE canvas_id=?')
      .all(canvasId) as unknown as ViewportRow[];
    const user = rows.find((row) => row.source === 'user');
    const agent = rows.find((row) => row.source === 'agent');
    return {
      userViewport: user ? this.viewportFromRow(user) : defaultViewport(canvas.bounds),
      agentViewport: agent ? this.viewportFromRow(agent) : null
    };
  }

  recordViewport(
    canvasId: string,
    input: CanvasViewportInput | Record<string, unknown>,
    sourceFallback: 'user' | 'agent' = 'user'
  ): CanvasViewport {
    this.getCanvas(canvasId);
    const viewport = normalizeViewportInput(input, sourceFallback);
    const updatedAt = timestamp();
    this.db
      .prepare(`INSERT INTO canvas_viewports
        (canvas_id,source,center_x,center_y,zoom,width,height,updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(canvas_id,source) DO UPDATE SET center_x=excluded.center_x,center_y=excluded.center_y,
        zoom=excluded.zoom,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at`)
      .run(
        canvasId,
        viewport.source,
        viewport.centerX,
        viewport.centerY,
        viewport.zoom,
        viewport.width,
        viewport.height,
        updatedAt
      );
    return { ...viewport, updatedAt };
  }

  private readCachedBatchResponse(
    canvasId: string,
    idempotencyKey: string | undefined,
    requestDigest: string
  ): string | null {
    if (!idempotencyKey) return null;
    const cached = this.db
      .prepare(
        'SELECT request_hash, response_json FROM canvas_idempotency_keys WHERE canvas_id=? AND document_version=2 AND key=?'
      )
      .get(canvasId, idempotencyKey) as { request_hash: string; response_json: string } | undefined;
    if (!cached) return null;
    if (cached.request_hash !== requestDigest) {
      throw new CanvasError(
        'idempotency_conflict',
        'idempotency key was reused with a different request',
        'idempotency',
        409
      );
    }
    return cached.response_json;
  }

  private prepareOperations(
    canvasId: string,
    request: V2CanvasBatchRequest
  ): {
    canvas: V2CanvasRecord;
    elements: CanvasElement[];
    normalizedOperations: JsonObject[];
    revision: number;
    updatedAt: string;
  } {
    const canvas = this.getCanvas(canvasId);
    checkRevision(request.expectedRevision, canvas.revision);
    let elements = [...canvas.elements];
    const geometryWrites = new Set<string>();
    const normalizedOperations: JsonObject[] = [];
    for (const raw of request.operations) {
      if (!raw || typeof raw !== 'object' || typeof raw.op !== 'string') {
        throw new CanvasError('validation_error', 'operation requires op', 'validation', 400);
      }
      if (raw.op === 'clear') {
        elements = [];
        normalizedOperations.push({ op: 'clear' });
        continue;
      }
      const elementId = 'elementId' in raw ? validateSafeId(raw.elementId, 'elementId') : null;
      if (raw.op === 'deleteElement') {
        elements = elements.filter((element) => element.id !== elementId);
        normalizedOperations.push({ op: 'deleteElement', elementId: elementId as string });
        continue;
      }
      if (raw.op === 'upsertElement') {
        const element = this.elementValidator.normalizeForWrite(raw.element);
        geometryWrites.add(element.id);
        const index = elements.findIndex((current) => current.id === element.id);
        if (index >= 0) {
          if (elements[index].type !== element.type || elements[index].schemaVersion !== element.schemaVersion) {
            throw new CanvasError(
              'immutable_element_identity',
              'element type and schemaVersion cannot change during upsert; delete it first',
              'validation',
              409
            );
          }
          elements[index] = element;
        } else elements.push(element);
        normalizedOperations.push({ op: 'upsertElement', element: element as unknown as JsonObject });
        continue;
      }
      const index = elements.findIndex((element) => element.id === elementId);
      if (index < 0) throw new CanvasError('not_found', `element not found: ${elementId}`, 'not_found', 404);
      const current = elements[index];
      if (raw.op === 'patchElementFrame') {
        const frame = this.elementValidator.normalizeFramePatch(raw.frame);
        elements[index] = { ...current, ...frame };
        if (['x', 'y', 'width', 'height'].some((key) => Object.hasOwn(frame, key))) geometryWrites.add(current.id);
        normalizedOperations.push({ op: 'patchElementFrame', elementId: current.id, frame: frame as JsonObject });
      } else if (raw.op === 'replaceElementData') {
        if (!isJsonObject(raw.data)) {
          throw new CanvasError('validation_error', 'replacement data must be a JSON object', 'validation', 400);
        }
        const replacement = this.elementValidator.normalizeForWrite({
          ...current,
          data: raw.data,
          ...(Object.hasOwn(raw, 'style') ? { style: raw.style } : {})
        });
        elements[index] = replacement;
        if (
          replacement.x !== current.x ||
          replacement.y !== current.y ||
          replacement.width !== current.width ||
          replacement.height !== current.height
        )
          geometryWrites.add(current.id);
        normalizedOperations.push({
          op: 'replaceElementData',
          elementId: current.id,
          data: replacement.data,
          ...(replacement.style !== undefined ? { style: replacement.style } : {})
        });
      } else if (raw.op === 'replaceElementMetadata') {
        if (!isJsonObject(raw.metadata)) {
          throw new CanvasError('validation_error', 'replacement metadata must be a JSON object', 'validation', 400);
        }
        elements[index] = { ...current, metadata: structuredClone(raw.metadata) };
        normalizedOperations.push({ op: 'replaceElementMetadata', elementId: current.id, metadata: raw.metadata });
      } else {
        throw new CanvasError(
          'validation_error',
          `unsupported operation: ${(raw as { op: string }).op}`,
          'validation',
          400
        );
      }
    }
    if (elements.length > 2_000)
      throw new CanvasError('validation_error', 'canvas exceeds 2000 elements', 'validation', 400);
    for (const element of elements) {
      if (geometryWrites.has(element.id)) validateElementBounds(element, canvas.bounds);
    }
    return {
      canvas,
      elements,
      normalizedOperations,
      revision: canvas.revision + 1,
      updatedAt: timestamp()
    };
  }

  private recordEvent(
    canvasId: string,
    revision: number,
    operation: JsonObject,
    createdAt: string,
    actor?: string
  ): void {
    this.db
      .prepare(`INSERT INTO canvas_events
        (id,canvas_id,revision,operation_json,created_at,actor,document_version) VALUES (?,?,?,?,?,?,2)`)
      .run(`event_${nanoid(12)}`, canvasId, revision, serialize(operation), createdAt, actor ?? null);
  }

  private viewportFromRow(row: ViewportRow): CanvasViewport {
    return {
      centerX: row.center_x,
      centerY: row.center_y,
      zoom: row.zoom,
      width: row.width,
      height: row.height,
      source: row.source,
      updatedAt: row.updated_at
    };
  }

  private fromRow(row: CanvasRow): V2CanvasRecord {
    if (row.document_version !== 2) {
      throw new CanvasError(
        'database_version_invalid',
        `canvas ${row.id} has document version ${row.document_version}`,
        'storage',
        500
      );
    }
    const rawElements = parse<unknown[]>(row.elements_json, []);
    if (!Array.isArray(rawElements)) {
      throw new CanvasError('stored_canvas_invalid', `canvas ${row.id} elements are not an array`, 'storage', 500);
    }
    const ids = new Set<string>();
    const elements = rawElements.map((value) => {
      const element = this.elementValidator.validatePersisted(value, { allowMissingPlugin: true });
      if (ids.has(element.id)) {
        throw new CanvasError(
          'stored_canvas_invalid',
          `canvas ${row.id} has duplicate element ${element.id}`,
          'storage',
          500
        );
      }
      ids.add(element.id);
      return element;
    });
    const bounds = normalizeCanvasBounds(parse<CanvasBounds | null>(row.bounds_json, null));
    const metadata = parse<unknown>(row.metadata_json, {});
    if (!isJsonObject(metadata)) {
      throw new CanvasError('stored_canvas_invalid', `canvas ${row.id} metadata is invalid`, 'storage', 500);
    }
    const rawTheme = parse<unknown>(row.theme_json, null);
    let theme: CanvasThemeV1 | null = null;
    if (rawTheme !== null) {
      try {
        theme = normalizeCanvasTheme(rawTheme);
      } catch (error) {
        throw new CanvasError(
          'stored_canvas_invalid',
          `canvas ${row.id} theme is invalid: ${error instanceof Error ? error.message : String(error)}`,
          'storage',
          500
        );
      }
    }
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      project: row.project,
      conversationId: row.conversation_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      bounds,
      ...(bounds.mode === 'fixed' ? { width: bounds.width, height: bounds.height } : {}),
      background: parse(row.background_json, null),
      theme,
      elements,
      revision: row.revision,
      metadata,
      documentVersion: 2
    };
  }
}
