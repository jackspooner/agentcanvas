import type { PluginDiagnostic, PluginDiagnostics } from './diagnostics.js';
import type { CanvasElement, ElementDefaultFrame } from './element.js';
import type { JsonObject, JsonSchema, JsonValue } from './json.js';
import type { SnapshotContribution } from './snapshot.js';
import type { CanvasThemeV1 } from './theme.js';

/** Expected input rejection. Its message is returned to callers; never include secrets or internal details. */
export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

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
  theme: Readonly<CanvasThemeV1>;
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
  /** Snapshot renderer deadline in milliseconds, an integer from 1 through 30000. */
  snapshotTimeoutMs?: number;
  schemaMigrations?: readonly ElementSchemaMigration[];
  validate?(element: Readonly<CanvasElement>, context: ElementValidationContext): readonly PluginValidationIssue[];
  /**
   * Report non-blocking, deterministic quality issues in a persisted element.
   * Unlike `validate`, inspection issues do not prevent writes. The host exposes
   * them to agents and viewers so content-fit and similar concerns can be
   * repaired without duplicating plugin-owned rules in the core runtime.
   */
  inspect?(element: Readonly<CanvasElement>, context: ElementValidationContext): readonly PluginValidationIssue[];
  summarize(element: Readonly<CanvasElement>): ElementSummary;
  resolve?(element: Readonly<CanvasElement>, context: ElementRuntimeContext): Promise<ElementResolution>;
  renderSnapshot?(
    element: Readonly<CanvasElement>,
    context: SnapshotRendererContext
  ): SnapshotContribution | Promise<SnapshotContribution>;
}

/** Shared deadline constraint for descriptor registration and snapshot collection. */
export function isSnapshotTimeoutMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 30_000;
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

export interface CanvasInspectionSummary extends JsonObject {
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface CanvasMutationReceipt extends JsonObject {
  canvasId: string;
  revision: number;
  inspectionSummary: CanvasInspectionSummary;
}

export const CANVAS_INSPECTION_SUMMARY_SCHEMA: JsonObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['errorCount', 'warningCount', 'infoCount'],
  properties: {
    errorCount: { type: 'integer', minimum: 0 },
    warningCount: { type: 'integer', minimum: 0 },
    infoCount: { type: 'integer', minimum: 0 }
  }
});

export const CANVAS_MUTATION_RECEIPT_SCHEMA: JsonObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['canvasId', 'revision', 'inspectionSummary'],
  properties: {
    canvasId: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    inspectionSummary: CANVAS_INSPECTION_SUMMARY_SCHEMA
  }
});

export interface PluginCanvasOperations {
  get(canvasId: string): Promise<JsonObject>;
  upsertElement(canvasId: string, element: CanvasElement, expectedRevision?: number): Promise<JsonObject>;
  upsertElementReceipt(
    canvasId: string,
    element: CanvasElement,
    expectedRevision?: number
  ): Promise<CanvasMutationReceipt>;
  replaceElementData(
    canvasId: string,
    elementId: string,
    data: JsonObject,
    style?: JsonObject | null,
    expectedRevision?: number
  ): Promise<JsonObject>;
  replaceElementDataReceipt(
    canvasId: string,
    elementId: string,
    data: JsonObject,
    style?: JsonObject | null,
    expectedRevision?: number
  ): Promise<CanvasMutationReceipt>;
  deleteElement(canvasId: string, elementId: string, expectedRevision?: number): Promise<JsonObject>;
  deleteElementReceipt(canvasId: string, elementId: string, expectedRevision?: number): Promise<CanvasMutationReceipt>;
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
  activate(host: ServerPluginHost): void | ServerPluginLifecycle | Promise<void | ServerPluginLifecycle>;
}

/** Per-activation services. Offline registries never start these hooks. */
export interface ServerPluginLifecycle {
  /** Called in dependency order after database binding and schema readiness. */
  start(context: PluginInvocationContext): void | Promise<void>;
  /** Synchronously stop timers and abort work before the database closes. */
  dispose(): void;
}
