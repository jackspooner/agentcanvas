import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpV2Server, type McpV2Runtime } from './server.js';

export async function handleMcpV2Request(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: McpV2Runtime
): Promise<void> {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
    response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
    return;
  }
  const { server } = createMcpV2Server(runtime);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } finally {
    const cleanup = await Promise.allSettled([transport.close(), server.close()]);
    for (const result of cleanup) {
      if (result.status === 'rejected') console.error('AgentCanvas MCP cleanup failed', result.reason);
    }
  }
}
