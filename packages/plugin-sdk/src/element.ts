import type { ElementType } from './identifiers.js';
import type { JsonObject } from './json.js';

export interface CanvasElement<TData extends JsonObject = JsonObject> {
  id: string;
  type: ElementType;
  schemaVersion: number;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  zIndex?: number | null;
  rotation?: number | null;
  opacity?: number | null;
  locked?: boolean | null;
  style?: JsonObject | null;
  metadata?: JsonObject;
  data: TData;
}

export interface CanvasElementFramePatch {
  x?: number;
  y?: number;
  width?: number | null;
  height?: number | null;
  zIndex?: number | null;
  rotation?: number | null;
  opacity?: number | null;
  locked?: boolean | null;
}

export interface ElementDefaultFrame {
  width?: number | null;
  height?: number | null;
}

export interface CanvasReadProjection {
  elementRuntime: Readonly<Record<string, JsonObject>>;
  diagnostics: readonly import('./diagnostics.js').PluginDiagnostic[];
}
