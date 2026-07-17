import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name.startsWith('.') ||
        ['data', 'dist', 'node_modules', 'plugins', 'plugins-disabled', 'tmp'].includes(entry.name)
      ) {
        continue;
      }
      result.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && /\.(?:m?[jt]s|tsx)$/.test(entry.name)) {
      result.push(path);
    }
  }
  return result;
}

describe('editor dependency boundary', () => {
  it('keeps React Flow imports inside the editor package', async () => {
    const root = resolve(import.meta.dirname, '..');
    const editorRoot = join(root, 'packages', 'editor');
    const offenders: string[] = [];
    for (const path of await sourceFiles(root)) {
      const text = await readFile(path, 'utf8');
      if (!/from\s+['"]@xyflow\/react['"]/.test(text)) continue;
      if (!path.startsWith(editorRoot)) offenders.push(relative(root, path));
    }
    expect(offenders).toEqual([]);
  }, 15_000);

  it('does not re-export React Flow through the public editor declaration root', async () => {
    const declaration = await readFile(
      resolve(import.meta.dirname, '..', 'packages', 'editor', 'dist', 'index.d.ts'),
      'utf8'
    );
    expect(declaration).not.toContain('@xyflow/react');
    expect(declaration).not.toContain('./projection.js');
    expect(declaration).not.toContain('./viewport.js');
  });
});
