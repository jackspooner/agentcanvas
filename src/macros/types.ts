import type { CanvasElement, CanvasOperation, CanvasRecord, JsonObject } from '../contracts.js';
import type { JsonSchema } from '@agentcanvas/plugin-sdk';

export type MacroScope = 'installation' | 'canvas';

export interface MacroRefInput {
  $macroRef: 'input';
  pointer: string;
}

export interface MacroRefGeneratedElementId {
  $macroRef: 'generatedElementId';
  elementKey: string;
}

export type MacroRef = MacroRefInput | MacroRefGeneratedElementId;

export interface MacroAnchor {
  x: number;
  y: number;
}

export interface MacroDependency {
  elementType: string;
  schemaVersion: number;
}

export interface MacroElementTemplate {
  key: string;
  type: string;
  schemaVersion: number;
  x: number;
  y: number;
  width: number;
  height: number;
  data: JsonObject;
  style?: JsonObject | null;
  metadata?: JsonObject;
}

export interface MacroDefinitionV1 {
  id: string;
  version: number;
  scope: MacroScope;
  canvasId?: string;
  title: string;
  description?: string;
  category?: string;
  inputSchema: JsonObject;
  dependencies?: readonly MacroDependency[];
  elements: readonly MacroElementTemplate[];
  outputs?: Readonly<Record<string, string>>;
}

/** Authoring payload; the host assigns id and version when it stores a definition. */
export type MacroDefinitionAuthoringV1 = Omit<MacroDefinitionV1, 'id' | 'version'>;

export type MacroCreateRequest = MacroDefinitionAuthoringV1;

export type MacroCreateVersionRequest = MacroDefinitionAuthoringV1 & {
  macroId: string;
  expectedCurrentVersion?: number;
};

export interface MacroListRequest {
  canvasId?: string;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

export interface MacroSummary {
  id: string;
  scope: MacroScope;
  canvasId?: string;
  currentVersion: number;
  archived: boolean;
  title: string;
  description?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MacroListResponse {
  items: readonly MacroSummary[];
  nextCursor?: string;
}

export interface MacroGetRequest {
  macroId: string;
  macroVersion: number;
  canvasId?: string;
}

export type MacroGetResponse = MacroDefinitionRecord;

export interface MacroArchiveRequest {
  macroId: string;
  archived: boolean;
}

export interface MacroArchiveResponse {
  macroId: string;
  currentVersion: number;
  archived: boolean;
}

export interface MacroCreateVersionInput extends MacroDefinitionAuthoringV1 {
  macroId: string;
  expectedCurrentVersion?: number;
}

export interface MacroDefinitionRecord {
  definition: MacroDefinitionV1;
  currentVersion: number;
  archived: boolean;
}

export type MacroCreateResponse = MacroDefinitionRecord;
export type MacroCreateVersionResponse = MacroDefinitionRecord;

export interface MacroCanvasSnapshot {
  id: string;
  revision: number;
  elements: readonly CanvasElement[];
  bounds: { mode: 'unlimited' } | { mode: 'fixed'; width: number; height: number };
  archived?: boolean;
}

export interface MacroPlanRequest {
  canvasId: string;
  anchor: MacroAnchor;
  input: JsonObject;
  label?: string;
  now?: Date | number;
}

export interface MacroDependencyContext {
  canvasId: string;
  definition: MacroDefinitionV1;
}

export interface MacroElementValidationContext {
  canvasId: string;
  definition: MacroDefinitionV1;
  elementKey: string;
}

export interface MacroPlannerOptions {
  validateDependencies?: (dependencies: readonly MacroDependency[], context: MacroDependencyContext) => void;
  validateElement?: (element: CanvasElement, context: MacroElementValidationContext) => CanvasElement;
  now?: () => number;
}

export interface MacroEffectSummary {
  label: string;
  operationCount: number;
  generatedElementCount: number;
  affectedElementIds: readonly string[];
}

export interface MacroHistory {
  label: string;
  forward: readonly CanvasOperation[];
  inverse: readonly CanvasOperation[];
  affectedElementIds: readonly string[];
}

export interface MacroProvenance {
  macroId: string;
  macroVersion: number;
  planId: string;
  inputDigest: string;
  planDigest: string;
}

export interface MacroPlan {
  planId: string;
  macroId: string;
  macroVersion: number;
  canvasId: string;
  canvasRevision: number;
  anchor: MacroAnchor;
  inputDigest: string;
  planDigest: string;
  createdAt: string;
  expiresAt: string;
  operations: readonly MacroUpsertOperation[];
  previewElements: readonly CanvasElement[];
  outputs: Readonly<Record<string, string>>;
  effectSummary: MacroEffectSummary;
}

export interface MacroRepository {
  /**
   * Looks up the requested macro ID and exact version. Implementations that
   * return undefined do not distinguish an unknown macro from an unavailable
   * version. When hasMacro is available, callers report an exact missing
   * version as macro_version_not_found; otherwise they report macro_not_found.
   */
  getDefinition(id: string, version: number, canvasId: string): MacroDefinitionRecord | MacroDefinitionV1 | undefined;
  hasMacro?: (id: string, canvasId: string) => boolean;
  getCanvas(canvasId: string): MacroCanvasSnapshot;
}

export interface MacroAtomicExecutionRequest {
  canvasId: string;
  expectedRevision: number;
  idempotencyKey: string;
  operations: readonly CanvasOperation[];
  provenance: MacroProvenance;
  outputs: Readonly<Record<string, string>>;
  effectSummary: MacroEffectSummary;
  history: MacroHistory;
}

export type MacroAtomicExecutionResult = MacroExecutionResult;

export interface MacroAtomicExecutor {
  executeMacro(request: MacroAtomicExecutionRequest): MacroAtomicExecutionResult | Promise<MacroAtomicExecutionResult>;
  replayMacro?: (
    request: MacroServiceExecuteRequest,
    requestDigest?: string
  ) => MacroExecutionResult | undefined | Promise<MacroExecutionResult | undefined>;
}

export interface MacroServicePlanRequest {
  canvasId: string;
  macroId: string;
  macroVersion: number;
  anchor: MacroAnchor;
  input: JsonObject;
  label?: string;
  now?: Date | number;
}

export interface MacroServiceExecuteRequest {
  canvasId: string;
  planId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface CanvasRunMacroPlanRequest {
  mode: 'plan';
  canvasId: string;
  planId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface CanvasRunMacroDirectRequest {
  mode: 'direct';
  canvasId: string;
  macroId: string;
  macroVersion: number;
  anchor: MacroAnchor;
  input: JsonObject;
  expectedRevision: number;
  idempotencyKey: string;
  label?: string;
}

export type CanvasRunMacroRequest = CanvasRunMacroPlanRequest | CanvasRunMacroDirectRequest;
export type CanvasRunMacroResponse = MacroExecutionResult;

export interface MacroExecutionResult {
  canvas: MacroCanvasSnapshot | CanvasRecord;
  provenance: MacroProvenance;
  outputs: Readonly<Record<string, string>>;
  history: MacroHistory;
}

export type MacroUpsertOperation = Extract<CanvasOperation, { op: 'upsertElement' }> & {
  element: CanvasElement;
};

export type MacroJsonSchema = JsonSchema;
