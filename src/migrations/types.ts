export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface CanonicalElement<TData extends JsonObject = JsonObject> {
  id: string;
  type: `${string}/${string}`;
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

export interface LegacyTypeDefinition {
  legacyType: string;
  targetType: `${string}/${string}` | null;
  pluginId: string | null;
  dataFields: readonly string[];
  removed?: boolean;
}

export interface LegacyImporterResult {
  data: JsonObject;
  style?: JsonObject | null;
}

/**
 * Pure importer supplied by the plugin that owns the target element type.
 * Implementations must not contact external services or mutate their input.
 */
export interface LegacyElementImporter {
  legacyType: string;
  targetType: `${string}/${string}`;
  schemaVersion: number;
  import(element: Readonly<JsonObject>, context: { canvasId: string; elementId: string }): LegacyImporterResult;
}

export type MigrationIssueSeverity = 'warning' | 'blocker';

export interface MigrationIssue {
  code:
    | 'database_missing'
    | 'database_unreadable'
    | 'duplicate_element_id'
    | 'group_element_present'
    | 'invalid_document_version'
    | 'malformed_elements_json'
    | 'missing_importer'
    | 'unexpected_legacy_field'
    | 'unknown_legacy_type'
    | 'validation_failed';
  severity: MigrationIssueSeverity;
  message: string;
  canvasId?: string;
  elementId?: string;
  field?: string;
  legacyType?: string;
}

export interface RuntimeFieldOccurrence {
  canvasId: string;
  elementId: string;
  legacyType: string;
  field: string;
}

export interface GroupBlocker {
  canvasId: string;
  elementId: string;
}

export interface TypeMappingCount {
  legacyType: string;
  targetType: `${string}/${string}` | null;
  count: number;
}

export interface MigrationCounts {
  canvases: number;
  elements: number;
  shareLinks: number;
  events: number;
  idempotencyRows: number;
}

export interface DatabaseVersionState {
  physicalVersion: number;
  documentVersions: number[];
  inferredLegacyDocumentVersion: boolean;
}

export interface DatabaseCheckResult {
  integrity: string[];
  foreignKeyViolations: number;
}

export interface MigrationInspectionReport {
  databasePath: string;
  intendedBackupPath: string;
  generatedAt: string;
  sourceVersion: 1 | 2 | null;
  targetVersion: 2;
  versions: DatabaseVersionState;
  checks: DatabaseCheckResult;
  counts: MigrationCounts;
  typeMappings: TypeMappingCount[];
  requiredPluginImporters: string[];
  runtimeFieldsToStrip: RuntimeFieldOccurrence[];
  groupBlockers: GroupBlocker[];
  issues: MigrationIssue[];
  canApply: boolean;
}

export interface MigrationVerificationSummary {
  sourceVersion: number;
  targetVersion: number;
  countsBefore: MigrationCounts;
  countsAfter: MigrationCounts;
  mappedElementCounts: TypeMappingCount[];
  strippedRuntimeFieldCount: number;
  invalidatedIdempotencyRows: number;
  preservedEventCount: number;
  preservedShareLinkCount: number;
  integrityOk: boolean;
  foreignKeysOk: boolean;
}
