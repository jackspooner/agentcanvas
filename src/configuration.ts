import type { CanvasBounds } from './contracts';
import { CanvasError } from './errors';
import { normalizeCanvasBounds } from './validation';

export interface AgentCanvasConfiguration {
  defaultCanvasSize: CanvasBounds;
  source: 'runtime-default' | 'stored';
  updatedAt: string | null;
}

export interface UpdateAgentCanvasConfigurationInput {
  defaultCanvasSize: CanvasBounds;
  actor?: string;
}

export function parseDefaultCanvasSizeSetting(
  value: string | undefined,
  fallback: CanvasBounds = { mode: 'unlimited' }
): CanvasBounds {
  if (value === undefined || value.trim() === '') return normalizeCanvasBounds(fallback);
  const normalized = value.trim().toLowerCase();
  if (normalized === 'unlimited' || normalized === 'infinite') return { mode: 'unlimited' };
  const match = normalized.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!match) throw new Error('AGENT_CANVAS_DEFAULT_SIZE must be unlimited or WIDTHxHEIGHT, for example 1600x1000');
  return normalizeCanvasBounds({ mode: 'fixed', width: Number(match[1]), height: Number(match[2]) });
}

export function normalizeConfigurationUpdate(value: unknown): UpdateAgentCanvasConfigurationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CanvasError('validation_error', 'configuration payload must be an object', 'validation', 400);
  const input = value as Record<string, unknown>;
  if (input.defaultCanvasSize === undefined)
    throw new CanvasError('validation_error', 'defaultCanvasSize is required', 'validation', 400);
  return {
    defaultCanvasSize: normalizeCanvasBounds(input.defaultCanvasSize),
    actor: typeof input.actor === 'string' ? input.actor : undefined
  };
}
