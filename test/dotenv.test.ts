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
    fs.writeFileSync(
      path.join(dir, '.env'),
      [
        'AGENT_CANVAS_HOST=0.0.0.0',
        'AGENT_CANVAS_ALLOW_REMOTE=true',
        'AGENT_CANVAS_PORT=29123',
        'AGENT_CANVAS_PUBLIC_BASE_URL=http://example.test:29123',
        'AGENT_CANVAS_DB=./custom-agent-canvas.sqlite',
        'AGENT_CANVAS_DEFAULT_SIZE=1440x900',
        'ASSETS_BASE_URL=http://assets.example.test',
        ''
      ].join('\n')
    );

    delete process.env.AGENT_CANVAS_HOST;
    delete process.env.AGENT_CANVAS_ALLOW_REMOTE;
    delete process.env.AGENT_CANVAS_PORT;
    delete process.env.AGENT_CANVAS_PUBLIC_BASE_URL;
    delete process.env.AGENT_CANVAS_DB;
    delete process.env.AGENT_CANVAS_DEFAULT_SIZE;
    delete process.env.ASSETS_BASE_URL;
    process.chdir(dir);

    loadAgentCanvasDotenv();

    expect(loadConfig()).toMatchObject({
      host: '0.0.0.0',
      port: 29123,
      publicBaseUrl: 'http://example.test:29123',
      databasePath: './custom-agent-canvas.sqlite',
      defaultCanvasSize: { mode: 'fixed', width: 1440, height: 900 },
      security: {
        allowRemote: true,
        allowedHosts: ['example.test:29123', '0.0.0.0:29123'],
        allowedOrigins: ['http://example.test:29123']
      }
    });
  });

  it('uses unlimited as the default canvas size and accepts the legacy infinite setting', () => {
    delete process.env.AGENT_CANVAS_DEFAULT_SIZE;
    expect(loadConfig().defaultCanvasSize).toEqual({ mode: 'unlimited' });
    process.env.AGENT_CANVAS_DEFAULT_SIZE = 'infinite';
    expect(loadConfig().defaultCanvasSize).toEqual({ mode: 'unlimited' });
  });

  it('rejects malformed default canvas sizes', () => {
    process.env.AGENT_CANVAS_DEFAULT_SIZE = 'wide';
    expect(() => loadConfig()).toThrow(/unlimited or WIDTHxHEIGHT/i);
  });
});
