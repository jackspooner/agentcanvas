import { config } from 'dotenv';

let loaded = false;

export function loadAgentCanvasDotenv() {
  if (loaded) return;
  config();
  loaded = true;
}
