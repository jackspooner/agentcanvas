import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AgentCanvasConfig } from '../config.js';
import { loadAgentCanvasDotenv } from '../dotenv.js';
import { AGENTCANVAS_VERSION } from '../version.js';

/**
 * Stdio is intentionally a transport bridge. The resident HTTP MCP endpoint owns plugin discovery,
 * registry freezing, schemas, and execution, so stdio can never drift into a second runtime.
 */
export function resolveResidentMcpUrl(
  config: Pick<AgentCanvasConfig, 'publicBaseUrl'>,
  environment: Readonly<{ AGENT_CANVAS_BASE_URL?: string }> = process.env
): URL {
  return new URL('/mcp', environment.AGENT_CANVAS_BASE_URL ?? config.publicBaseUrl);
}

export async function runStdioMcpBridge(): Promise<void> {
  loadAgentCanvasDotenv();
  const config = loadConfig();
  const client = new Client({ name: 'AgentCanvasStdioBridgeClient', version: AGENTCANVAS_VERSION });
  const http = new StreamableHTTPClientTransport(resolveResidentMcpUrl(config));
  await client.connect(http);

  const server = new Server(
    { name: 'AgentCanvasMcp', version: AGENTCANVAS_VERSION },
    { capabilities: { tools: {} }, instructions: 'Proxies the resident AgentCanvas registry over stdio.' }
  );
  server.setRequestHandler(ListToolsRequestSchema, async (request) => client.listTools(request.params));
  server.setRequestHandler(CallToolRequestSchema, async (request) => client.callTool(request.params));

  const stdio = new StdioServerTransport();
  const close = async (): Promise<void> => {
    await Promise.allSettled([server.close(), client.close()]);
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  await server.connect(stdio);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStdioMcpBridge().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
