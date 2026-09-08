import type { CanvasBounds } from './contracts';
import { CanvasError } from './errors';
import { normalizeCanvasBounds } from './validation';
import type { JsonObject } from '@agentcanvas/plugin-sdk';

export const OVERLAP_MODES = ['off', 'bounded', 'all'] as const;
export interface DiagnosticsConfiguration {
  overlapMode: (typeof OVERLAP_MODES)[number];
  maxOverlapWarnings: number;
}
export const DEFAULT_DIAGNOSTICS_CONFIGURATION: Readonly<DiagnosticsConfiguration> = Object.freeze({
  overlapMode: 'bounded',
  maxOverlapWarnings: 100
});
export const MAX_OVERLAP_WARNING_LIMIT = 10_000;
export const DIAGNOSTICS_CONFIGURATION_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['overlapMode', 'maxOverlapWarnings'],
  properties: {
    overlapMode: {
      type: 'string',
      enum: [...OVERLAP_MODES],
      description: 'off skips overlap checks; bounded stops after the warning limit; all reports every overlap.'
    },
    maxOverlapWarnings: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_OVERLAP_WARNING_LIMIT,
      description: 'Overlap warning limit in bounded mode; other diagnostics are unaffected.'
    }
  }
};

export function normalizeDiagnosticsConfiguration(value: unknown): DiagnosticsConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CanvasError('validation_error', 'diagnostics must be an object', 'validation', 400);
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'overlapMode' && key !== 'maxOverlapWarnings') ||
    !OVERLAP_MODES.some((mode) => mode === input.overlapMode) ||
    typeof input.maxOverlapWarnings !== 'number' ||
    !Number.isSafeInteger(input.maxOverlapWarnings) ||
    input.maxOverlapWarnings < 1 ||
    input.maxOverlapWarnings > MAX_OVERLAP_WARNING_LIMIT
  )
    throw new CanvasError(
      'validation_error',
      'diagnostics requires overlapMode off, bounded or all and maxOverlapWarnings from 1 through 10000',
      'validation',
      400
    );
  return {
    overlapMode: input.overlapMode as DiagnosticsConfiguration['overlapMode'],
    maxOverlapWarnings: input.maxOverlapWarnings
  };
}

export interface AgentCanvasConfiguration {
  defaultCanvasSize: CanvasBounds;
  diagnostics: DiagnosticsConfiguration;
  source: 'runtime-default' | 'stored';
  updatedAt: string | null;
}

export interface UpdateAgentCanvasConfigurationInput {
  defaultCanvasSize?: CanvasBounds;
  diagnostics?: DiagnosticsConfiguration;
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
  if (
    Object.keys(input).some((key) => !['defaultCanvasSize', 'diagnostics', 'actor'].includes(key)) ||
    (input.defaultCanvasSize === undefined && input.diagnostics === undefined) ||
    (input.actor !== undefined && typeof input.actor !== 'string')
  )
    throw new CanvasError(
      'validation_error',
      'configuration requires defaultCanvasSize or diagnostics and an optional string actor',
      'validation',
      400
    );
  return {
    ...(input.defaultCanvasSize === undefined
      ? {}
      : { defaultCanvasSize: normalizeCanvasBounds(input.defaultCanvasSize) }),
    ...(input.diagnostics === undefined ? {} : { diagnostics: normalizeDiagnosticsConfiguration(input.diagnostics) }),
    actor: typeof input.actor === 'string' ? input.actor : undefined
  };
}
