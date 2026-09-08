import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTCANVAS_HOST_API_VERSION, AGENTCANVAS_VERSION } from '../src/version.js';

describe('public version contract', () => {
  it('keeps the runtime version aligned with the root package', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version?: unknown };
    expect(AGENTCANVAS_VERSION).toBe(packageJson.version);
  });

  it('advertises the additive renderer command and deadline host API', () => {
    expect(AGENTCANVAS_HOST_API_VERSION).toBe('1.2.0');
  });
});
