import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAgentCanvasDotenv } from '../dotenv';
import { createAgentCanvasMcpServer } from './server';

loadAgentCanvasDotenv();
const server = createAgentCanvasMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
