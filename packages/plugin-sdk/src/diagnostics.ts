export type PluginDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface PluginDiagnostic {
  code: string;
  severity: PluginDiagnosticSeverity;
  message: string;
  retryable: boolean;
  pluginId?: string;
  elementId?: string;
}

export interface PluginDiagnostics {
  emit(diagnostic: PluginDiagnostic): void;
}
