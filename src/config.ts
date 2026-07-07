import path from 'node:path';

export interface AgentCanvasConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  assetsBaseUrl: string;
  databasePath: string;
}

export function loadConfig(overrides: Partial<AgentCanvasConfig> = {}): AgentCanvasConfig {
  const port = Number(process.env.AGENT_CANVAS_PORT ?? overrides.port ?? 23003);
  const host = process.env.AGENT_CANVAS_HOST ?? overrides.host ?? '127.0.0.1';
  const publicBaseUrl = process.env.AGENT_CANVAS_PUBLIC_BASE_URL ?? overrides.publicBaseUrl ?? `http://${host}:${port}`;
  const assetsBaseUrl = process.env.ASSETS_BASE_URL ?? overrides.assetsBaseUrl ?? 'http://127.0.0.1:23000';
  const databasePath =
    process.env.AGENT_CANVAS_DB ?? overrides.databasePath ?? path.resolve('data', 'agent-canvas.sqlite');
  return { host, port, publicBaseUrl, assetsBaseUrl, databasePath };
}
