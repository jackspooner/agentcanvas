export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
export const LOCAL_CONTRIBUTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export type ElementType = `${string}/${string}`;

export function isPluginId(value: string): boolean {
  return value.length <= 128 && PLUGIN_ID_PATTERN.test(value);
}

export function isLocalContributionName(value: string): boolean {
  return value.length <= 64 && LOCAL_CONTRIBUTION_NAME_PATTERN.test(value);
}

export function deriveElementType(pluginId: string, localName: string): ElementType {
  assertPluginId(pluginId);
  assertLocalContributionName(localName);
  return `${pluginId}/${localName}`;
}

export function deriveToolName(pluginId: string, localName: string): string {
  assertPluginId(pluginId);
  assertLocalContributionName(localName);
  return `${pluginId.replace(/[.-]/g, '_')}__${localName.replace(/-/g, '_')}`;
}

export function assertPluginId(value: string): asserts value is string {
  if (!isPluginId(value)) {
    throw new TypeError(`Invalid AgentCanvas plugin id: ${value}`);
  }
}

export function assertLocalContributionName(value: string): asserts value is string {
  if (!isLocalContributionName(value)) {
    throw new TypeError(`Invalid AgentCanvas contribution name: ${value}`);
  }
}
