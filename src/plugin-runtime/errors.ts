export type PluginRuntimeErrorCode =
  | 'plugin_manifest_invalid'
  | 'plugin_path_invalid'
  | 'plugin_dependency_invalid'
  | 'plugin_capability_invalid'
  | 'plugin_activation_invalid';

export class PluginRuntimeError extends Error {
  constructor(
    readonly code: PluginRuntimeErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'PluginRuntimeError';
  }
}
