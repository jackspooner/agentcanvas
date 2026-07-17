import type { AgentCanvasExtensionDefinition } from '@agentcanvas/extension-sdk';
import { assertPluginManifestStructure } from '@agentcanvas/plugin-testkit';

export * from '@agentcanvas/plugin-testkit';

export function assertExtensionDefinition(definition: AgentCanvasExtensionDefinition): void {
  assertPluginManifestStructure(definition.manifest);
  const expected = {
    elements: definition.contributes.elements,
    commands: definition.contributes.commands.map((command) => command.name),
    tools: definition.contributes.tools,
    procedures: definition.contributes.procedures,
    migrations: definition.contributes.migrations
  };
  if (JSON.stringify(definition.manifest.contributes) !== JSON.stringify(expected)) {
    throw new Error('Extension descriptors do not match the generated manifest contributions.');
  }
}
