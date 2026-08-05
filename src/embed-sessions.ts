import { nanoid } from 'nanoid';
import { CanvasError } from './errors.js';
import { normalizeAllowedOrigin } from './security.js';

export const EMBED_SESSION_LIMITS = {
  maxCanvasIds: 25,
  minTtlSeconds: 60,
  maxTtlSeconds: 86_400,
  maxActiveSessions: 1_000
} as const;

export type EmbedSessionMode = 'read' | 'edit';

export interface CreateEmbedSessionInput {
  canvasIds: string[];
  mode: EmbedSessionMode;
  parentOrigin: string;
  expiresInSeconds: number;
}

export interface EmbedSessionSummary {
  id: string;
  canvasIds: string[];
  mode: EmbedSessionMode;
  parentOrigin: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreatedEmbedSession {
  session: EmbedSessionSummary;
  url: string;
}

interface EmbedSessionRecord extends EmbedSessionSummary {
  token: string;
}

export const EMBED_SESSION_CREATE_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['canvasIds', 'mode', 'parentOrigin', 'expiresInSeconds'],
  properties: {
    canvasIds: {
      type: 'array',
      minItems: 1,
      maxItems: EMBED_SESSION_LIMITS.maxCanvasIds,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 200 }
    },
    mode: { enum: ['read', 'edit'] },
    parentOrigin: { type: 'string', minLength: 1, maxLength: 2_048 },
    expiresInSeconds: {
      type: 'integer',
      minimum: EMBED_SESSION_LIMITS.minTtlSeconds,
      maximum: EMBED_SESSION_LIMITS.maxTtlSeconds
    }
  }
} as const;

function publicSummary(record: EmbedSessionRecord): EmbedSessionSummary {
  return {
    id: record.id,
    canvasIds: [...record.canvasIds],
    mode: record.mode,
    parentOrigin: record.parentOrigin,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt
  };
}

export class EmbedSessionRegistry {
  private readonly sessions = new Map<string, EmbedSessionRecord>();

  constructor(
    private readonly publicBaseUrl: string,
    private readonly now: () => number = Date.now,
    private readonly maxActiveSessions = EMBED_SESSION_LIMITS.maxActiveSessions
  ) {}

  create(input: CreateEmbedSessionInput, assertCanvasExists: (canvasId: string) => void): CreatedEmbedSession {
    this.pruneExpired();
    if (this.sessions.size >= this.maxActiveSessions) {
      throw new CanvasError(
        'embed_session_capacity',
        'the active embed session limit has been reached',
        'storage',
        503,
        true
      );
    }

    const canvasIds = input.canvasIds.map((canvasId) => canvasId.trim());
    if (
      canvasIds.some((canvasId) => !canvasId) ||
      canvasIds.length < 1 ||
      canvasIds.length > EMBED_SESSION_LIMITS.maxCanvasIds ||
      new Set(canvasIds).size !== canvasIds.length
    ) {
      throw new CanvasError(
        'validation_error',
        `canvasIds must contain between 1 and ${EMBED_SESSION_LIMITS.maxCanvasIds} unique ids`,
        'validation',
        400
      );
    }
    if (input.mode !== 'read' && input.mode !== 'edit') {
      throw new CanvasError('validation_error', 'embed session mode must be read or edit', 'validation', 400);
    }
    if (
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < EMBED_SESSION_LIMITS.minTtlSeconds ||
      input.expiresInSeconds > EMBED_SESSION_LIMITS.maxTtlSeconds
    ) {
      throw new CanvasError(
        'validation_error',
        `expiresInSeconds must be an integer from ${EMBED_SESSION_LIMITS.minTtlSeconds} through ${EMBED_SESSION_LIMITS.maxTtlSeconds}`,
        'validation',
        400
      );
    }
    let parentOrigin: string;
    try {
      parentOrigin = normalizeAllowedOrigin(input.parentOrigin);
    } catch (error) {
      throw new CanvasError(
        'invalid_parent_origin',
        error instanceof Error ? error.message : 'parentOrigin is invalid',
        'validation',
        400
      );
    }
    for (const canvasId of canvasIds) assertCanvasExists(canvasId);

    const createdAtMs = this.now();
    const token = `embed_${nanoid(32)}`;
    const record: EmbedSessionRecord = {
      id: `embed_session_${nanoid(12)}`,
      token,
      canvasIds,
      mode: input.mode,
      parentOrigin,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + input.expiresInSeconds * 1_000).toISOString()
    };
    this.sessions.set(token, record);
    const url = new URL(`/embed/${encodeURIComponent(token)}`, this.publicBaseUrl);
    url.searchParams.set('canvasId', canvasIds[0]);
    return { session: publicSummary(record), url: url.toString() };
  }

  get(token: string): EmbedSessionSummary {
    return publicSummary(this.requireActive(token));
  }

  select(
    token: string,
    requestedCanvasId?: string | null
  ): {
    session: EmbedSessionSummary;
    canvasId: string;
  } {
    const record = this.requireActive(token);
    const canvasId = requestedCanvasId?.trim() || record.canvasIds[0];
    if (!record.canvasIds.includes(canvasId)) {
      throw new CanvasError(
        'embed_canvas_forbidden',
        'the requested canvas is not part of this embed session',
        'permission',
        403
      );
    }
    return { session: publicSummary(record), canvasId };
  }

  revoke(token: string): EmbedSessionSummary {
    const record = this.requireActive(token);
    this.sessions.delete(token);
    return publicSummary(record);
  }

  private requireActive(token: string): EmbedSessionRecord {
    const record = this.sessions.get(token);
    if (!record) throw new CanvasError('embed_session_not_found', 'embed session not found', 'not_found', 404);
    if (Date.parse(record.expiresAt) <= this.now()) {
      this.sessions.delete(token);
      throw new CanvasError('embed_session_expired', 'embed session expired', 'permission', 410);
    }
    return record;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, record] of this.sessions) {
      if (Date.parse(record.expiresAt) <= now) this.sessions.delete(token);
    }
  }
}
