import path from 'node:path';
import type { CanvasBounds } from './contracts';
import { parseDefaultCanvasSizeSetting } from './configuration';
import { loadSecurityConfig, type AgentCanvasSecurityConfig } from './security';

export interface AgentCanvasConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  databasePath: string;
  defaultCanvasSize: CanvasBounds;
  startupReadinessTimeoutMs: number;
  startupReadinessRetryIntervalMs: number;
  security: AgentCanvasSecurityConfig;
}

function boundedIntegerSetting(
  name: string,
  environmentValue: string | undefined,
  overrideValue: number | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const value = Number(environmentValue ?? overrideValue ?? defaultValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export function loadConfig(overrides: Partial<AgentCanvasConfig> = {}): AgentCanvasConfig {
  const port = Number(process.env.AGENT_CANVAS_PORT ?? overrides.port ?? 23003);
  const host = process.env.AGENT_CANVAS_HOST ?? overrides.host ?? '127.0.0.1';
  const publicBaseUrl = process.env.AGENT_CANVAS_PUBLIC_BASE_URL ?? overrides.publicBaseUrl ?? `http://${host}:${port}`;
  const databasePath =
    process.env.AGENT_CANVAS_DB ?? overrides.databasePath ?? path.resolve('data', 'agent-canvas.sqlite');
  const defaultCanvasSize = parseDefaultCanvasSizeSetting(
    process.env.AGENT_CANVAS_DEFAULT_SIZE,
    overrides.defaultCanvasSize
  );
  const startupReadinessTimeoutMs = boundedIntegerSetting(
    'AGENT_CANVAS_STARTUP_READINESS_TIMEOUT_MS',
    process.env.AGENT_CANVAS_STARTUP_READINESS_TIMEOUT_MS,
    overrides.startupReadinessTimeoutMs,
    30_000,
    0,
    300_000
  );
  const startupReadinessRetryIntervalMs = boundedIntegerSetting(
    'AGENT_CANVAS_STARTUP_READINESS_RETRY_INTERVAL_MS',
    process.env.AGENT_CANVAS_STARTUP_READINESS_RETRY_INTERVAL_MS,
    overrides.startupReadinessRetryIntervalMs,
    500,
    1,
    10_000
  );
  const security = loadSecurityConfig({ host, port, publicBaseUrl }, overrides.security);
  return {
    host,
    port,
    publicBaseUrl,
    databasePath,
    defaultCanvasSize,
    startupReadinessTimeoutMs,
    startupReadinessRetryIntervalMs,
    security
  };
}
