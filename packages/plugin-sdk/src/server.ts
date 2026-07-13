import type { PluginDiagnostic, PluginDiagnostics } from './diagnostics.js';
import type { CanvasElement, ElementDefaultFrame } from './element.js';
import type { JsonObject, JsonSchema, JsonValue } from './json.js';
import type { SnapshotContribution } from './snapshot.js';

export interface PluginValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ElementValidationContext {
  pluginId: string;
  type: string;
  schemaVersion: number;
}

export interface ElementResolution {
  runtime: JsonObject;
  diagnostics?: readonly PluginDiagnostic[];
}

export interface ElementSummary {
  title: string;
  detail?: string;
}

export interface ElementGeometryPoint {
  x: number;
  y: number;
}

export interface ElementGeometryFrame extends ElementGeometryPoint {
  width: number;
  height: number;
}

export interface ElementGeometryService {
  getElementFrame(elementId: string): ElementGeometryFrame | null;
  resolveAnchor(elementId: string, anchor: 'center' | 'top' | 'right' | 'bottom' | 'left'): ElementGeometryPoint | null;
}

export interface ElementRuntimeContext {
  signal: AbortSignal;
  canvasId: string;
  readOnly: boolean;
  geometry: ElementGeometryService;
}

export interface SnapshotRendererContext {
  signal: AbortSignal;
  canvasId: string;
  runtime: Readonly<JsonObject> | null;
}

export interface ElementSchemaMigration {
  fromVersion: number;
  toVersion: number;
  migrate(
    data: Readonly<JsonObject>,
    style: Readonly<JsonObject> | null
  ): {
    data: JsonObject;
    style?: JsonObject | null;
  };
}

export interface ElementTypeDescriptor {
  name: string;
  schemaVersion: number;
  dataSchema: JsonSchema;
  styleSchema?: JsonSchema;
  defaultFrame?: ElementDefaultFrame;
  browser: boolean;
  snapshot: 'supported' | 'unsupported';
  schemaMigrations?: readonly ElementSchemaMigration[];
  validate?(element: Readonly<CanvasElement>, context: ElementValidationContext): readonly PluginValidationIssue[];
  summarize(element: Readonly<CanvasElement>): ElementSummary;
  resolve?(element: Readonly<CanvasElement>, context: ElementRuntimeContext): Promise<ElementResolution>;
  renderSnapshot?(
    element: Readonly<CanvasElement>,
    context: SnapshotRendererContext
  ): SnapshotContribution | Promise<SnapshotContribution>;
}

export interface PluginToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface PluginInvocationContext {
  signal: AbortSignal;
  correlationId: string;
  canvas: PluginCanvasOperations;
}

export interface PluginCanvasOperations {
  get(canvasId: string): Promise<JsonObject>;
  upsertElement(canvasId: string, element: CanvasElement, expectedRevision?: number): Promise<JsonObject>;
  replaceElementData(
    canvasId: string,
    elementId: string,
    data: JsonObject,
    style?: JsonObject | null,
    expectedRevision?: number
  ): Promise<JsonObject>;
  deleteElement(canvasId: string, elementId: string, expectedRevision?: number): Promise<JsonObject>;
}

export interface PluginToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations?: PluginToolAnnotations;
  invoke(input: JsonObject, context: PluginInvocationContext): Promise<JsonObject>;
}

export interface PluginProcedureDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  invoke(input: JsonObject, context: PluginInvocationContext): Promise<JsonObject>;
}

export interface LegacyElementImportContext {
  canvasId: string;
  elementId: string;
}

export interface LegacyElementImportResult {
  element: CanvasElement;
  strippedFields?: readonly string[];
}

export interface PluginMigrationDescriptor {
  name: string;
  legacyTypes: readonly string[];
  importLegacy(
    element: Readonly<Record<string, unknown>>,
    context: LegacyElementImportContext
  ): LegacyElementImportResult;
}

export interface CapabilityReadiness {
  ok: boolean;
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface CapabilityProvider<T> {
  name: string;
  version: string;
  value: T;
  readiness?(): Promise<CapabilityReadiness>;
}

export interface CapabilityHandle<T> {
  readonly name: string;
  readonly range: string;
  get(): T;
  readiness(): Promise<CapabilityReadiness>;
}

export interface NamespacedPluginKv {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    entries: readonly { key: string; value: JsonValue }[];
    nextCursor?: string;
  }>;
}

export interface ServerPluginHost {
  registerElementType(descriptor: ElementTypeDescriptor): void;
  registerTool(descriptor: PluginToolDescriptor): void;
  registerProcedure(descriptor: PluginProcedureDescriptor): void;
  registerMigration(descriptor: PluginMigrationDescriptor): void;
  provideCapability<T>(descriptor: CapabilityProvider<T>): void;
  consumeCapability<T>(name: string, range: string): CapabilityHandle<T>;
  readonly config: Readonly<JsonObject>;
  readonly kv: NamespacedPluginKv;
  readonly diagnostics: PluginDiagnostics;
}

export interface AgentCanvasServerPlugin {
  activate(host: ServerPluginHost): void | Promise<void>;
}
