import { config } from 'dotenv';

let loaded = false;

export function loadAgentCanvasDotenv() {
  if (loaded) return;
  // Stdio MCP reserves stdout for JSON-RPC frames; dotenv's informational banner would corrupt it.
  config({ quiet: true });
  loaded = true;
}
