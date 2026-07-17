import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertExtensionDefinition } from '@agentcanvas/extension-testkit';
import { describe, expect, it } from 'vitest';
import extension from '../src/extension.mjs';

describe('__DISPLAY_NAME__ extension definition', () => {
  it('matches the generated static installation manifest', async () => {
    assertExtensionDefinition(extension);
    const manifest = JSON.parse(
      await readFile(resolve(import.meta.dirname, '..', 'agentcanvas.plugin.json'), 'utf8')
    ) as unknown;
    expect(manifest).toEqual(extension.manifest);
  });
});
