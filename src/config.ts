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
  security: AgentCanvasSecurityConfig;
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
  const security = loadSecurityConfig({ host, port, publicBaseUrl }, overrides.security);
  return {
    host,
    port,
    publicBaseUrl,
    databasePath,
    defaultCanvasSize,
    security
  };
}
