import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configuredPluginsRoot, defaultPluginsRoot } from '../src/plugin-runtime/bootstrap';

const savedPluginsRoot = process.env.AGENT_CANVAS_PLUGINS_ROOT;

describe('AgentCanvas extension root configuration', () => {
  afterEach(() => {
    if (savedPluginsRoot === undefined) delete process.env.AGENT_CANVAS_PLUGINS_ROOT;
    else process.env.AGENT_CANVAS_PLUGINS_ROOT = savedPluginsRoot;
  });

  it('uses the installation extension directory by default', () => {
    delete process.env.AGENT_CANVAS_PLUGINS_ROOT;
    expect(configuredPluginsRoot()).toBe(defaultPluginsRoot());
  });

  it('uses the configured directory while preserving explicit overrides', () => {
    process.env.AGENT_CANVAS_PLUGINS_ROOT = 'configured-plugins';
    expect(configuredPluginsRoot()).toBe(path.resolve('configured-plugins'));
    expect(configuredPluginsRoot('explicit-plugins')).toBe(path.resolve('explicit-plugins'));
  });
});
