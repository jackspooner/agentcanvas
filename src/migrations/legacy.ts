import type {
  CanonicalElement,
  GroupBlocker,
  JsonObject,
  JsonValue,
  LegacyElementImporter,
  LegacyTypeDefinition,
  MigrationIssue,
  RuntimeFieldOccurrence,
  TypeMappingCount
} from './types';

const ENVELOPE_FIELDS = new Set([
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'zIndex',
  'rotation',
  'opacity',
  'locked',
  'style',
  'metadata'
]);

export const RUNTIME_ONLY_LEGACY_FIELDS = new Set([
  'resolvedUrl',
  'posterResolvedUrl',
  'layoutResolvedUrl',
  'layoutSchema',
  'layoutResolutionError',
  'imageResolvedUrl'
]);

export const LEGACY_TYPE_DEFINITIONS: Readonly<Record<string, LegacyTypeDefinition>> = Object.freeze({
  asset: definition('asset', 'agentcanvas.assets2/asset', 'agentcanvas.assets2', ['assetRef', 'caption', 'fit', 'alt']),
  markdown: definition('markdown', 'agentcanvas.markdown/document', 'agentcanvas.markdown', ['markdown']),
  text: definition('text', 'agentcanvas.primitives/text', 'agentcanvas.primitives', ['text']),
  shape: definition('shape', 'agentcanvas.primitives/shape', 'agentcanvas.primitives', ['shape', 'label']),
  glbViewer: definition('glbViewer', 'agentcanvas.glb-viewer/model', 'agentcanvas.glb-viewer', [
    'assetRef',
    'caption',
    'alt',
    'cameraControls',
    'autoRotate'
  ]),
  table: definition('table', 'agentcanvas.table/table', 'agentcanvas.table', ['columns', 'rows', 'caption']),
  arrow: definition('arrow', 'agentcanvas.primitives/arrow', 'agentcanvas.primitives', [
    'from',
    'to',
    'label',
    'stroke',
    'strokeWidth'
  ]),
  bboxOverlay: definition('bboxOverlay', 'agentcanvas.image-overlays/bbox', 'agentcanvas.image-overlays', [
    'canvasWidth',
    'canvasHeight',
    'boxes',
    'layoutAssetRef',
    'imageAssetRef',
    'caption',
    'alt',
    'showLabels',
    'background'
  ]),
  video: definition('video', 'agentcanvas.video/video', 'agentcanvas.video', [
    'assetRef',
    'caption',
    'alt',
    'controls',
    'autoplay',
    'loop',
    'muted',
    'posterAssetRef'
  ]),
  pathOverlay: definition('pathOverlay', 'agentcanvas.image-overlays/path', 'agentcanvas.image-overlays', [
    'canvasWidth',
    'canvasHeight',
    'paths',
    'caption',
    'alt',
    'showLabels',
    'background'
  ]),
  line: definition('line', 'agentcanvas.primitives/line', 'agentcanvas.primitives', [
    'from',
    'to',
    'label',
    'stroke',
    'strokeWidth'
  ]),
  group: Object.freeze({
    legacyType: 'group',
    targetType: null,
    pluginId: null,
    dataFields: Object.freeze(['children']),
    removed: true
  })
});

function definition(
  legacyType: string,
  targetType: `${string}/${string}`,
  pluginId: string,
  dataFields: string[]
): LegacyTypeDefinition {
  return Object.freeze({ legacyType, targetType, pluginId, dataFields: Object.freeze(dataFields) });
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function optionalJsonObject(value: unknown, field: string): JsonObject | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isObject(value)) throw new Error(`${field} must be a JSON object or null`);
  return value;
}

function sanitizedLegacyElement(element: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(element).filter(([field, value]) => !RUNTIME_ONLY_LEGACY_FIELDS.has(field) && value !== undefined)
  ) as JsonObject;
}

export interface LegacyElementAnalysis {
  issues: MigrationIssue[];
  runtimeFields: RuntimeFieldOccurrence[];
  groupBlockers: GroupBlocker[];
  mapping: TypeMappingCount | null;
  pluginId: string | null;
  elementId: string | null;
}

export function analyzeLegacyElement(canvasId: string, value: unknown): LegacyElementAnalysis {
  const issues: MigrationIssue[] = [];
  const runtimeFields: RuntimeFieldOccurrence[] = [];
  const groupBlockers: GroupBlocker[] = [];
  if (!isObject(value)) {
    issues.push({
      code: 'validation_failed',
      severity: 'blocker',
      message: 'legacy element must be a JSON object',
      canvasId
    });
    return { issues, runtimeFields, groupBlockers, mapping: null, pluginId: null, elementId: null };
  }

  const elementId = typeof value.id === 'string' ? value.id : null;
  const legacyType = typeof value.type === 'string' ? value.type : null;
  const definition = legacyType ? LEGACY_TYPE_DEFINITIONS[legacyType] : undefined;
  if (!definition) {
    issues.push({
      code: 'unknown_legacy_type',
      severity: 'blocker',
      message: `unknown legacy element type: ${legacyType ?? '<missing>'}`,
      canvasId,
      ...(elementId ? { elementId } : {}),
      ...(legacyType ? { legacyType } : {})
    });
    return { issues, runtimeFields, groupBlockers, mapping: null, pluginId: null, elementId };
  }
  const knownLegacyType = definition.legacyType;

  if (definition.removed) {
    const blocker = { canvasId, elementId: elementId ?? '<missing>' };
    groupBlockers.push(blocker);
    issues.push({
      code: 'group_element_present',
      severity: 'blocker',
      message: `removed group element prevents migration: ${blocker.elementId}`,
      canvasId,
      elementId: blocker.elementId,
      legacyType: knownLegacyType
    });
  }

  const allowedFields = new Set([...ENVELOPE_FIELDS, ...definition.dataFields, ...RUNTIME_ONLY_LEGACY_FIELDS]);
  for (const [field, fieldValue] of Object.entries(value)) {
    if (RUNTIME_ONLY_LEGACY_FIELDS.has(field)) {
      if (fieldValue !== undefined && fieldValue !== null) {
        runtimeFields.push({ canvasId, elementId: elementId ?? '<missing>', legacyType: knownLegacyType, field });
      }
      continue;
    }
    if (!allowedFields.has(field)) {
      issues.push({
        code: 'unexpected_legacy_field',
        severity: 'blocker',
        message: `unexpected field ${field} on legacy ${legacyType} element`,
        canvasId,
        ...(elementId ? { elementId } : {}),
        legacyType: knownLegacyType,
        field
      });
    }
  }

  return {
    issues,
    runtimeFields,
    groupBlockers,
    mapping: { legacyType: knownLegacyType, targetType: definition.targetType, count: 1 },
    pluginId: definition.pluginId,
    elementId
  };
}

export function canonicalizeLegacyElement(
  value: unknown,
  importer: LegacyElementImporter,
  context: { canvasId: string; elementId: string } = { canvasId: '<unknown>', elementId: '<unknown>' }
): CanonicalElement {
  if (!isObject(value)) throw new Error('legacy element must be a JSON object');
  const legacyType = typeof value.type === 'string' ? value.type : '';
  const definition = LEGACY_TYPE_DEFINITIONS[legacyType];
  if (!definition) throw new Error(`unknown legacy element type: ${legacyType || '<missing>'}`);
  if (definition.removed || !definition.targetType) throw new Error(`legacy ${legacyType} elements cannot be migrated`);
  const analysis = analyzeLegacyElement('<canonicalization>', value);
  const blocker = analysis.issues.find((issue) => issue.severity === 'blocker');
  if (blocker) throw new Error(blocker.message);
  if (importer.legacyType !== legacyType)
    throw new Error(`importer for ${importer.legacyType} cannot import legacy ${legacyType}`);
  if (importer.targetType !== definition.targetType)
    throw new Error(`importer target ${importer.targetType} does not match declared target ${definition.targetType}`);
  if (!Number.isInteger(importer.schemaVersion) || importer.schemaVersion < 1)
    throw new Error('importer schemaVersion must be a positive integer');

  const imported = importer.import(Object.freeze(sanitizedLegacyElement(value)), context);
  if (!isObject(imported?.data)) throw new Error('legacy importer must return a JSON object as data');
  const style = imported.style === undefined ? optionalJsonObject(value.style, 'style') : imported.style;
  const metadata = optionalJsonObject(value.metadata, 'metadata');
  const envelope: CanonicalElement = {
    id: typeof value.id === 'string' && value.id ? value.id : fail('element id is required'),
    type: definition.targetType,
    schemaVersion: importer.schemaVersion,
    x: finite(value.x, 'x'),
    y: finite(value.y, 'y'),
    data: imported.data
  };
  for (const field of ['width', 'height', 'zIndex', 'rotation', 'opacity'] as const) {
    const fieldValue = value[field];
    if (fieldValue !== undefined) envelope[field] = fieldValue === null ? null : finite(fieldValue, field);
  }
  if (value.locked !== undefined) {
    if (value.locked !== null && typeof value.locked !== 'boolean') throw new Error('locked must be boolean or null');
    envelope.locked = value.locked;
  }
  if (style !== undefined) envelope.style = style;
  if (metadata !== undefined && metadata !== null) envelope.metadata = metadata;
  return envelope;
}

function fail(message: string): never {
  throw new Error(message);
}

export function copyLegacyDataFields(element: Readonly<JsonObject>, fields: readonly string[]): JsonObject {
  const data: JsonObject = {};
  for (const field of fields) {
    const value = element[field];
    if (value !== undefined && !RUNTIME_ONLY_LEGACY_FIELDS.has(field)) data[field] = value as JsonValue;
  }
  return data;
}
