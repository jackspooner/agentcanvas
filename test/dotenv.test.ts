import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { loadAgentCanvasDotenv } from '../src/dotenv';

const originalCwd = process.cwd();
const savedEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, savedEnv);
}

describe('AgentCanvas dotenv bootstrap', () => {
  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv();
  });

  it('loads a local .env file before configuration is read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-dotenv-'));
    fs.writeFileSync(path.join(dir, '.env'), [
      'AGENT_CANVAS_HOST=0.0.0.0',
      'AGENT_CANVAS_PORT=29123',
      'AGENT_CANVAS_PUBLIC_BASE_URL=http://example.test:29123',
      'AGENT_CANVAS_DB=./custom-agent-canvas.sqlite',
      'ASSETS_BASE_URL=http://assets.example.test',
      ''
    ].join('\n'));

    delete process.env.AGENT_CANVAS_HOST;
    delete process.env.AGENT_CANVAS_PORT;
    delete process.env.AGENT_CANVAS_PUBLIC_BASE_URL;
    delete process.env.AGENT_CANVAS_DB;
    delete process.env.ASSETS_BASE_URL;
    process.chdir(dir);

    loadAgentCanvasDotenv();

    expect(loadConfig()).toEqual({
      host: '0.0.0.0',
      port: 29123,
      publicBaseUrl: 'http://example.test:29123',
      databasePath: './custom-agent-canvas.sqlite',
      assetsBaseUrl: 'http://assets.example.test'
    });
  });
});
