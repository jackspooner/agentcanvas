import { defineCommand, defineExtension } from '@agentcanvas/extension-sdk';
import { describe, expect, it } from 'vitest';
import { assertExtensionDefinition, ManualRendererFrameScheduler } from '../src/index.js';

describe('extension definition conformance', () => {
  it('accepts generated manifests whose descriptors cannot drift', () => {
    const definition = defineExtension({
      manifest: {
        id: 'example.commands',
        version: '1.0.0',
        displayName: 'Commands',
        description: 'Command example.',
        license: 'MIT',
        entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
        requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
        provides: { capabilities: {} },
        permissions: []
      },
      contributes: { commands: [defineCommand({ name: 'run', title: 'Run' })] }
    });
    expect(() => assertExtensionDefinition(definition)).not.toThrow();
  });

  it('provides a deterministic renderer frame scheduler', () => {
    const failures: unknown[] = [];
    const scheduler = new ManualRendererFrameScheduler((error) => failures.push(error));
    const frames: Array<{ timestamp: number; deltaMs: number }> = [];
    scheduler.subscribe((frame) => frames.push(frame));
    scheduler.subscribe(() => {
      throw new Error('fixture failure');
    });

    scheduler.step(10);
    scheduler.step(26);
    scheduler.setActive(false);
    scheduler.step(1_000);
    scheduler.setActive(true);
    scheduler.step(1_016);

    expect(frames).toEqual([
      { timestamp: 10, deltaMs: 0 },
      { timestamp: 26, deltaMs: 16 },
      { timestamp: 1_016, deltaMs: 0 }
    ]);
    expect(failures).toHaveLength(1);
  });
});
