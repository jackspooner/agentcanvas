import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('primitives distribution', () => {
  it('loads the emitted server entry under the host tsx loader', () => {
    const packageRoot = resolve(process.cwd());
    const serverUrl = pathToFileURL(resolve(packageRoot, 'dist', 'server.mjs')).href;
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--eval', `await import(${JSON.stringify(serverUrl)}); console.log('loaded')`],
      {
        cwd: packageRoot,
        encoding: 'utf8'
      }
    );
    expect(output.trim()).toBe('loaded');
  });
});
