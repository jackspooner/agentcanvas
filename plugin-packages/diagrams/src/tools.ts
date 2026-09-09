import { CanvasError } from '@agentcanvas/core/errors';
import type { CanvasElement, JsonObject, PluginInvocationContext, ServerPluginHost } from '@agentcanvas/extension-sdk';
import { DEFAULT_CANVAS_THEME, type CanvasThemeV1 } from '@agentcanvas/extension-sdk';
import type { DiagramIssue, ErdData, ErdOperation, MermaidData } from './contracts.js';
import { applyErdOperations } from './erd/domain.js';
import { layoutErd } from './erd/layout.js';
import { assertErd } from './erd/validation.js';
import { exportErdMermaid } from './mermaid/export.js';
import { convertMermaidErd, validateMermaid, inspectMermaidLayout, validateMermaidRender } from './mermaid/headless.js';
import { validateMermaidData } from './mermaid/policy.js';
import { exportOutputSchema, mutationOutputSchema, toolInputs, validationOutputSchema } from './schemas.js';

export function diagramIssues(error: unknown): DiagramIssue[] {
  if (error && typeof error === 'object' && 'diagnostics' in error && Array.isArray(error.diagnostics))
    return error.diagnostics as DiagramIssue[];
  return [
    {
      path: '/source',
      code: 'diagram_render_failed',
      message: error instanceof Error ? error.message : 'Diagram rendering failed.'
    }
  ];
}
function invalid(issues: DiagramIssue[]): never {
  throw new CanvasError(
    'validation_error',
    issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join('\n'),
    'validation'
  );
}
function json(value: unknown): JsonObject {
  return value as JsonObject;
}
function checkRevision(canvas: JsonObject, expected: unknown): void {
  if (expected !== undefined && expected !== canvas.revision)
    throw new CanvasError(
      'revision_conflict',
      `Expected revision ${expected}; current revision is ${canvas.revision}. Read the diagram before editing again.`,
      'revision',
      409
    );
}
function findElement(canvas: JsonObject, id: string, type: 'erd' | 'mermaid'): CanvasElement {
  const element = (canvas.elements as unknown as CanvasElement[]).find((item) => item.id === id);
  if (!element) throw new CanvasError('element_not_found', `Element ${id} does not exist.`, 'not_found', 404);
  if (element.type !== `agentcanvas.diagrams/${type}`)
    throw new CanvasError('validation_error', `Element ${id} must be a Diagrams ${type}.`, 'validation');
  return element;
}
function writable(element: CanvasElement): void {
  if (element.locked) throw new CanvasError('validation_error', 'Unlock the diagram before editing it.', 'validation');
}
async function create(
  input: JsonObject,
  context: PluginInvocationContext,
  type: 'erd' | 'mermaid',
  data: ErdData | MermaidData,
  diagnostics: DiagramIssue[] = []
): Promise<JsonObject> {
  const canvasId = input.canvasId as string;
  const canvas = await context.canvas.get(canvasId);
  checkRevision(canvas, input.expectedRevision);
  const id = typeof input.id === 'string' ? input.id : crypto.randomUUID();
  if ((canvas.elements as unknown as CanvasElement[]).some((element) => element.id === id))
    throw new CanvasError(
      'validation_error',
      `Element ID ${id} already exists; creation never replaces existing elements.`,
      'validation'
    );
  const element: CanvasElement = {
    id,
    type: `agentcanvas.diagrams/${type}`,
    schemaVersion: 2,
    x: input.x as number,
    y: input.y as number,
    width: (input.width as number | undefined) ?? (type === 'erd' ? 960 : 720),
    height: (input.height as number | undefined) ?? (type === 'erd' ? 640 : 480),
    data: json(data)
  };
  context.signal.throwIfAborted();
  const result = await context.canvas.upsertElement(canvasId, element, canvas.revision as number);
  const affectedIds =
    type === 'erd'
      ? [
          id,
          ...(data as ErdData).entities.flatMap((entity) => [
            entity.id,
            ...entity.attributes.map((attribute) => attribute.id)
          ]),
          ...(data as ErdData).relationships.map((relationship) => relationship.id)
        ]
      : [id];
  return json({
    ok: true,
    canvasId,
    elementId: id,
    revision: result.revision,
    affectedIds,
    removedRelationshipIds: [],
    diagnostics
  });
}
async function validate(source: string, signal: AbortSignal): Promise<{ diagramType: string }> {
  try {
    return await validateMermaid(source, signal);
  } catch (error) {
    invalid(diagramIssues(error));
  }
}
async function validateData(data: MermaidData, canvas: JsonObject, signal: AbortSignal) {
  const issues = validateMermaidData(data);
  if (issues.length) invalid(issues);
  try {
    return await validateMermaidRender(
      data.source,
      (canvas.theme as unknown as CanvasThemeV1 | undefined) ?? DEFAULT_CANVAS_THEME,
      signal,
      data.presentation
    );
  } catch (error) {
    invalid(diagramIssues(error));
  }
}

export function registerDiagramTools(host: ServerPluginHost): void {
  const descriptions: Record<string, string> = {
    'create-erd':
      'Create a native entity relationship diagram. Choose preserve to retain positions, or LR/TB for automatic layout. Returns stable IDs; refresh the canvas after mutation.',
    'edit-erd':
      'Apply an atomic batch to a native ERD at expectedRevision. Entity/attribute deletion cascades attached relationships, returned in removedRelationshipIds. Refresh canvas, element inspection, and snapshots after success.',
    'create-mermaid':
      'Parse and render supported Mermaid source before creating a diagram. Returns stable element identity; refresh the canvas after success.',
    'update-mermaid':
      'Validate exact replacement Mermaid source, then save at expectedRevision. Syntax errors preserve the existing element. Refresh canvas, resolution, and snapshots after success.',
    'validate-mermaid':
      'Validate Mermaid without writes. Use purpose layout to inspect stable box and connector IDs and coordinates for this exact source; optional canvasId resolves its theme. Pass presentation to inspect overrides. Use returned IDs in update-mermaid data.presentation. Source changes require explicitly omitting/resetting presentation. Optionally analyze ERD conversion.',
    'export-mermaid':
      'Export a native ERD to validated Mermaid source and explicit losses. Does not change the diagram.',
    'convert-mermaid-erd':
      'Create an independent native ERD from an existing Mermaid ERD at expectedRevision. Acknowledge each conversion warning code. Original source remains unchanged. Refresh canvas and snapshots after creation.'
  };
  for (const name of Object.keys(descriptions))
    host.registerTool({
      name,
      title: name.split('-').join(' '),
      description: descriptions[name],
      inputSchema: toolInputs[name],
      outputSchema:
        name === 'validate-mermaid'
          ? validationOutputSchema
          : name === 'export-mermaid'
            ? exportOutputSchema
            : mutationOutputSchema,
      annotations: {
        readOnlyHint: ['validate-mermaid', 'export-mermaid'].includes(name),
        destructiveHint: ['edit-erd', 'update-mermaid'].includes(name),
        idempotentHint: ['validate-mermaid', 'export-mermaid'].includes(name),
        openWorldHint: false
      },
      async invoke(input, context) {
        if (name === 'validate-mermaid') {
          try {
            if (input.purpose === 'layout') {
              const canvas = input.canvasId ? await context.canvas.get(input.canvasId as string) : undefined;
              const inspected = await inspectMermaidLayout(
                input.source as string,
                (canvas?.theme as unknown as CanvasThemeV1 | undefined) ?? DEFAULT_CANVAS_THEME,
                context.signal,
                input.presentation as unknown as MermaidData['presentation']
              );
              return json({ ok: true, ...inspected, issues: [], warnings: [] });
            }
            const parsed = await validateMermaid(input.source as string, context.signal);
            const converted =
              input.purpose === 'convert-to-erd'
                ? await convertMermaidErd(input.source as string, context.signal)
                : null;
            return json({
              ok: true,
              diagramType: parsed.diagramType,
              issues: [],
              warnings: converted?.warnings ?? [],
              ...(converted ? { data: converted.data } : {})
            });
          } catch (error) {
            return json({ ok: false, diagramType: null, issues: diagramIssues(error), warnings: [] });
          }
        }
        if (name === 'create-erd') {
          const data = input.data as unknown as ErdData;
          assertErd(data);
          return create(
            input,
            context,
            'erd',
            input.layout === 'preserve' ? data : layoutErd(data, input.layout as 'LR' | 'TB')
          );
        }
        if (name === 'create-mermaid') {
          const data = input.data as unknown as MermaidData;
          await validateData(data, await context.canvas.get(input.canvasId as string), context.signal);
          return create(input, context, 'mermaid', data);
        }
        const canvasId = input.canvasId as string;
        const canvas = await context.canvas.get(canvasId);
        checkRevision(canvas, input.expectedRevision);
        const element = findElement(
          canvas,
          input.elementId as string,
          ['edit-erd', 'export-mermaid'].includes(name) ? 'erd' : 'mermaid'
        );
        if (name === 'export-mermaid') {
          let exported: ReturnType<typeof exportErdMermaid>;
          try {
            exported = exportErdMermaid(element.data as unknown as ErdData);
          } catch (error) {
            invalid(diagramIssues(error));
          }
          await validate(exported.source, context.signal);
          return json({ ok: true, ...exported });
        }
        if (name === 'convert-mermaid-erd') {
          let converted: Awaited<ReturnType<typeof convertMermaidErd>>;
          try {
            converted = await convertMermaidErd(element.data.source as string, context.signal);
          } catch (error) {
            invalid(diagramIssues(error));
          }
          const acknowledged = new Set(input.acknowledgeWarnings as string[] | undefined);
          if (element.data.presentation)
            converted.warnings.push({
              path: '/presentation',
              code: 'mermaid.erd.presentation',
              message: 'Saved Mermaid appearance and manual geometry are omitted from the independent native copy.'
            });
          const missing = converted.warnings.filter((issue) => !acknowledged.has(issue.code));
          if (missing.length)
            invalid(
              missing.map((issue) => ({
                ...issue,
                message: `Acknowledge ${issue.code} before conversion: ${issue.message}`
              }))
            );
          return create(input, context, 'erd', layoutErd(converted.data), converted.warnings);
        }
        writable(element);
        const changed =
          name === 'edit-erd'
            ? applyErdOperations(element.data as unknown as ErdData, input.operations as unknown as ErdOperation[])
            : null;
        const data = changed?.data ?? (input.data as unknown as MermaidData);
        if (name === 'update-mermaid') await validateData(data as MermaidData, canvas, context.signal);
        context.signal.throwIfAborted();
        const result = await context.canvas.replaceElementData(
          canvasId,
          element.id,
          json(data),
          undefined,
          input.expectedRevision as number
        );
        return json({
          ok: true,
          canvasId,
          elementId: element.id,
          revision: result.revision,
          affectedIds: changed?.affectedIds ?? [element.id],
          removedRelationshipIds: changed?.removedRelationshipIds ?? [],
          diagnostics: []
        });
      }
    });
}
