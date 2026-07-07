import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAgentCanvasMcpServer } from './server';
import type { McpHandlerOptions } from './client';

export async function handleAgentCanvasMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: McpHandlerOptions = {}
) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null
      })
    );
    return;
  }

  const mcpServer = createAgentCanvasMcpServer(options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response);
  } finally {
    await transport.close().catch(() => undefined);
    await mcpServer.close().catch(() => undefined);
  }
}
