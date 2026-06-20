import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentCanvasMcpServer } from './server';

const server = createAgentCanvasMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
