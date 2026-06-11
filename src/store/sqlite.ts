import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { loadConfig, type AgentCanvasConfig } from '../config';
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH, type CanvasBatchRequest, type CanvasElement, type CanvasOperation, type CanvasRecord, type CanvasViewport, type CanvasViewportInput, type CanvasViewportState, type CreateCanvasInput, type CreateShareLinkInput, type ShareLinkRecord } from '../contracts';
import { CanvasError } from '../errors';
import { defaultViewport, ensureElementCap, normalizeCanvasElement, normalizeOperations, normalizeViewportInput } from '../validation';
import { SCHEMA_SQL } from './schema';

interface CanvasRow {
  id: string;
  title: string;
  description: string | null;
  project: string | null;
  conversation_id: string | null;
  created_by: CanvasRecord['createdBy'];
  created_at: string;
  updated_at: string;
  width: number;
  height: number;
  background_json: string | null;
  elements_json: string;
  revision: number;
  metadata_json: string | null;
}

interface ShareRow {
  id: string;
  canvas_id: string;
  token_hash: string;
  mode: 'read';
  label: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface ViewportRow {
  canvas_id: string;
  source: 'user' | 'agent';
  center_x: number;
  center_y: number;
  zoom: number;
  width: number;
  height: number;
  updated_at: string;
}

function json<T>(value: T): string { return JSON.stringify(value ?? null); }
function parse<T>(value: string | null, fallback: T): T { return value ? JSON.parse(value) as T : fallback; }
function now(): string { return new Date().toISOString(); }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function requestHash(value: unknown): string { return hash(JSON.stringify(value)); }

export class SqliteCanvasStore {
  readonly db: DatabaseSync;
  readonly config: AgentCanvasConfig;

  constructor(databasePath?: string, config: Partial<AgentCanvasConfig> = {}) {
    this.config = loadConfig({ ...config, databasePath: databasePath ?? config.databasePath });
    if (this.config.databasePath !== ':memory:') fs.mkdirSync(path.dirname(this.config.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.config.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void { this.db.close(); }

  createCanvas(input: CreateCanvasInput): CanvasRecord {
    if (!input.title || typeof input.title !== 'string') throw new CanvasError('validation_error', 'canvas title is required', 'validation', 400);
    const t = now();
    const canvas: CanvasRecord = {
      id: `canvas_${nanoid(12)}`,
      title: input.title,
      description: input.description ?? null,
      project: input.project ?? null,
      conversationId: input.conversationId ?? null,
      createdBy: input.createdBy ?? 'agent',
      createdAt: t,
      updatedAt: t,
      width: input.width ?? DEFAULT_CANVAS_WIDTH,
      height: input.height ?? DEFAULT_CANVAS_HEIGHT,
      background: input.background ?? null,
      elements: [],
      revision: 1,
      metadata: input.metadata ?? {}
    };
    this.db.prepare(`INSERT INTO canvases (id,title,description,project,conversation_id,created_by,created_at,updated_at,width,height,background_json,elements_json,revision,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        canvas.id, canvas.title, canvas.description ?? null, canvas.project ?? null, canvas.conversationId ?? null, canvas.createdBy, canvas.createdAt, canvas.updatedAt,
        canvas.width, canvas.height, json(canvas.background), json(canvas.elements), canvas.revision, json(canvas.metadata)
      );
    return canvas;
  }

  listCanvases(filter: { project?: string; conversationId?: string; limit?: number } = {}): CanvasRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];
    if (filter.project) { clauses.push('project = ?'); params.push(filter.project); }
    if (filter.conversationId) { clauses.push('conversation_id = ?'); params.push(filter.conversationId); }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM canvases ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params, limit) as unknown as CanvasRow[];
    return rows.map((r) => this.fromRow(r));
  }

  getCanvas(id: string): CanvasRecord {
    const row = this.db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as unknown as CanvasRow | undefined;
    if (!row) throw new CanvasError('not_found', `canvas not found: ${id}`, 'not_found', 404);
    return this.fromRow(row);
  }

  applyOperations(canvasId: string, request: CanvasBatchRequest): CanvasRecord {
    if (request.idempotencyKey) {
      const reqHash = requestHash({ canvasId, operations: request.operations, expectedRevision: request.expectedRevision });
      const cached = this.db.prepare('SELECT request_hash, response_json FROM canvas_idempotency_keys WHERE key = ?').get(request.idempotencyKey) as unknown as { request_hash: string; response_json: string } | undefined;
      if (cached) {
        if (cached.request_hash !== reqHash) throw new CanvasError('idempotency_conflict', 'idempotency key was reused with a different request', 'idempotency', 409);
        return JSON.parse(cached.response_json) as CanvasRecord;
      }
      const response = this.applyOperationsUncached(canvasId, request);
      this.db.prepare('INSERT INTO canvas_idempotency_keys (key, canvas_id, request_hash, response_json, created_at) VALUES (?,?,?,?,?)')
        .run(request.idempotencyKey, canvasId, reqHash, json(response), now());
      return response;
    }
    return this.applyOperationsUncached(canvasId, request);
  }

  createShareLink(canvasId: string, input: CreateShareLinkInput = {}): ShareLinkRecord & { token: string; url: string } {
    this.getCanvas(canvasId);
    const token = `share_${nanoid(24)}`;
    const t = now();
    const link: ShareLinkRecord = {
      id: `link_${nanoid(12)}`,
      canvasId,
      mode: input.mode ?? 'read',
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: t,
      revokedAt: null
    };
    this.db.prepare('INSERT INTO canvas_share_links (id, canvas_id, token_hash, mode, label, expires_at, created_at, revoked_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(link.id, canvasId, hash(token), link.mode, link.label ?? null, link.expiresAt ?? null, link.createdAt, link.revokedAt ?? null);
    return { ...link, token, url: `${this.config.publicBaseUrl}/c/${token}` };
  }

  resolveShareToken(token: string): { link: ShareLinkRecord; canvas: CanvasRecord } {
    const row = this.db.prepare('SELECT * FROM canvas_share_links WHERE token_hash = ? AND revoked_at IS NULL').get(hash(token)) as unknown as ShareRow | undefined;
    if (!row) throw new CanvasError('not_found', 'share link not found', 'not_found', 404);
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) throw new CanvasError('permission_denied', 'share link expired', 'permission', 403);
    const link: ShareLinkRecord = { id: row.id, canvasId: row.canvas_id, mode: row.mode, label: row.label, expiresAt: row.expires_at, createdAt: row.created_at, revokedAt: row.revoked_at };
    return { link, canvas: this.getCanvas(row.canvas_id) };
  }

  getViewportState(canvasId: string): CanvasViewportState {
    this.getCanvas(canvasId);
    const rows = this.db.prepare('SELECT * FROM canvas_viewports WHERE canvas_id = ?').all(canvasId) as unknown as ViewportRow[];
    const userRow = rows.find((row) => row.source === 'user');
    const agentRow = rows.find((row) => row.source === 'agent');
    return {
      userViewport: userRow ? this.viewportFromRow(userRow) : defaultViewport(),
      agentViewport: agentRow ? this.viewportFromRow(agentRow) : null
    };
  }

  recordViewport(canvasId: string, input: CanvasViewportInput | Record<string, unknown>, sourceFallback: 'user' | 'agent' = 'user'): CanvasViewport {
    this.getCanvas(canvasId);
    const normalized = normalizeViewportInput(input, sourceFallback);
    const updatedAt = now();
    this.db.prepare(`INSERT INTO canvas_viewports (canvas_id, source, center_x, center_y, zoom, width, height, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(canvas_id, source) DO UPDATE SET center_x=excluded.center_x, center_y=excluded.center_y, zoom=excluded.zoom, width=excluded.width, height=excluded.height, updated_at=excluded.updated_at`)
      .run(canvasId, normalized.source, normalized.centerX, normalized.centerY, normalized.zoom, normalized.width, normalized.height, updatedAt);
    return { ...normalized, updatedAt };
  }

  private applyOperationsUncached(canvasId: string, request: CanvasBatchRequest): CanvasRecord {
    const canvas = this.getCanvas(canvasId);
    if (request.expectedRevision !== undefined && request.expectedRevision !== canvas.revision) {
      throw new CanvasError('revision_conflict', `expected revision ${request.expectedRevision}, current revision ${canvas.revision}`, 'revision', 409, true);
    }
    const operations = normalizeOperations(request.operations) as CanvasOperation[];
    let elements = [...canvas.elements];
    for (const op of operations) {
      if (op.op === 'clear') elements = [];
      if (op.op === 'deleteElement') elements = elements.filter((el) => el.id !== op.elementId);
      if (op.op === 'upsertElement') {
        const element = normalizeCanvasElement(op.element);
        const idx = elements.findIndex((el) => el.id === element.id);
        if (idx >= 0) elements[idx] = element;
        else elements.push(element);
      }
      if (op.op === 'patchElement') {
        const idx = elements.findIndex((el) => el.id === op.elementId);
        if (idx < 0) throw new CanvasError('not_found', `element not found: ${op.elementId}`, 'not_found', 404);
        elements[idx] = normalizeCanvasElement({ ...elements[idx], ...op.patch, id: elements[idx].id, type: elements[idx].type });
      }
    }
    ensureElementCap(elements);
    const revision = canvas.revision + 1;
    const t = now();
    this.db.prepare('UPDATE canvases SET elements_json = ?, revision = ?, updated_at = ? WHERE id = ?').run(json(elements), revision, t, canvasId);
    for (const op of operations) {
      this.db.prepare('INSERT INTO canvas_events (id, canvas_id, revision, operation_json, created_at, actor) VALUES (?,?,?,?,?,?)')
        .run(`event_${nanoid(12)}`, canvasId, revision, json(op), t, request.actor ?? null);
    }
    return { ...canvas, elements, revision, updatedAt: t };
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

  private fromRow(row: CanvasRow): CanvasRecord {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      project: row.project,
      conversationId: row.conversation_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      width: row.width,
      height: row.height,
      background: parse(row.background_json, null),
      elements: parse(row.elements_json, []),
      revision: row.revision,
      metadata: parse(row.metadata_json, {})
    };
  }
}
