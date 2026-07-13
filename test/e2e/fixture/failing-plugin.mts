import type { AgentCanvasBrowserPlugin } from '@agentcanvas/plugin-sdk';

const plugin: AgentCanvasBrowserPlugin = {
  activate(host) {
    host.registerRenderer({
      type: 'fixture.fail/card',
      schemaVersions: [1],
      placement: 'node',
      mount() {
        throw new Error('fixture renderer mount failure');
      }
    });
  }
};

export default plugin;
