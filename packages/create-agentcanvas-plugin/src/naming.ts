export interface PluginNames {
  directoryName: string;
  pluginId: string;
  packageName: string;
  displayName: string;
}

const validName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function derivePluginNames(input: string): PluginNames {
  const directoryName = input.trim().toLowerCase();
  if (!validName.test(directoryName)) {
    throw new Error(
      'Plugin name must use lowercase letters, numbers, and single hyphens, and must start with a letter.'
    );
  }
  const words = directoryName.split('-');
  return {
    directoryName,
    pluginId: directoryName,
    packageName: `agentcanvas-plugin-${directoryName}`,
    displayName: words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
  };
}
