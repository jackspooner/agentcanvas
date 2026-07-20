import type {
  AgentCanvasServerPlugin,
  CanvasElement,
  ElementTypeDescriptor,
  JsonObject,
  PluginInvocationContext,
  PluginToolDescriptor,
  ServerPluginHost
} from '@agentcanvas/plugin-sdk';
import { resolveConnectorEndpoints } from './browser/geometry.js';
import { importLegacyPrimitive } from './legacy.js';
import type { ConnectorEndpointData } from './browser/data.js';
import {
  addConnectorInputSchema,
  addShapeInputSchema,
  addTextInputSchema,
  connectorDataSchema,
  mutationOutputSchema,
  primitiveStyleSchema,
  shapeDataSchema,
  textDataSchema
} from './schemas.js';
import { renderConnectorSnapshot, renderShapeSnapshot, renderTextSnapshot } from './snapshot.js';

function optionalNumber(input: JsonObject, key: string): number | null | undefined {
  const value = input[key];
  return typeof value === 'number' || value === null ? value : undefined;
}

function completeElement(
  input: JsonObject,
  type: string,
  data: JsonObject,
  defaults: { width: number; height: number }
): CanvasElement {
  const element: CanvasElement = {
    id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
    type: type as CanvasElement['type'],
    schemaVersion: 1,
    x: input.x as number,
    y: input.y as number,
    width: optionalNumber(input, 'width') ?? defaults.width,
    height: optionalNumber(input, 'height') ?? defaults.height,
    data
  };
  for (const key of ['zIndex', 'rotation', 'opacity'] as const) {
    const value = optionalNumber(input, key);
    if (value !== undefined) element[key] = value;
  }
  if (typeof input.locked === 'boolean' || input.locked === null) element.locked = input.locked;
  if (input.style && typeof input.style === 'object' && !Array.isArray(input.style)) element.style = input.style;
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata))
    element.metadata = input.metadata;
  return element;
}

function tool(
  name: string,
  title: string,
  description: string,
  inputSchema: JsonObject,
  makeElement: (input: JsonObject) => CanvasElement
): PluginToolDescriptor {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema: mutationOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async invoke(input: JsonObject, context: PluginInvocationContext): Promise<JsonObject> {
      const element = makeElement(input);
      const canvasId = input.canvasId as string;
      const result = await context.canvas.upsertElement(
        canvasId,
        element,
        input.expectedRevision as number | undefined
      );
      return { ok: true, canvasId, elementId: element.id, result };
    }
  };
}

const descriptors: ElementTypeDescriptor[] = [
  {
    name: 'text',
    schemaVersion: 1,
    dataSchema: textDataSchema,
    styleSchema: primitiveStyleSchema,
    defaultFrame: { width: 240, height: 100 },
    browser: true,
    snapshot: 'supported',
    summarize: (element) => ({ title: String(element.data.text ?? '').slice(0, 80) || 'Text' }),
    renderSnapshot: (element, context) => renderTextSnapshot(element, context.theme)
  },
  {
    name: 'shape',
    schemaVersion: 1,
    dataSchema: shapeDataSchema,
    styleSchema: primitiveStyleSchema,
    defaultFrame: { width: 240, height: 160 },
    browser: true,
    snapshot: 'supported',
    summarize: (element) => ({ title: String(element.data.label ?? element.data.shape ?? 'Shape') }),
    renderSnapshot: (element, context) => renderShapeSnapshot(element, context.theme)
  },
  ...(['line', 'arrow'] as const).map(
    (name): ElementTypeDescriptor => ({
      name,
      schemaVersion: 1,
      dataSchema: connectorDataSchema,
      styleSchema: primitiveStyleSchema,
      defaultFrame: { width: 0, height: 0 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        return (['from', 'to'] as const).flatMap((key) => {
          const endpoint = element.data[key];
          if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return [];
          const hasElement = typeof endpoint.elementId === 'string' && endpoint.elementId.length > 0;
          const hasPoint = typeof endpoint.x === 'number' && typeof endpoint.y === 'number';
          return hasElement || hasPoint
            ? []
            : [
                {
                  path: `/data/${key}`,
                  code: 'connector_endpoint_incomplete',
                  message: 'connector endpoint requires an elementId or both x and y'
                }
              ];
        });
      },
      summarize: (element) => ({ title: String(element.data.label ?? (name === 'arrow' ? 'Arrow' : 'Line')) }),
      async resolve(element, context) {
        const geometry = resolveConnectorEndpoints(
          element.data.from as unknown as ConnectorEndpointData,
          element.data.to as unknown as ConnectorEndpointData,
          context.geometry
        );
        return {
          runtime: {
            connectorGeometry: {
              from: { x: geometry.from.x, y: geometry.from.y },
              to: { x: geometry.to.x, y: geometry.to.y }
            }
          } as JsonObject,
          diagnostics: geometry.missingElementIds.map((elementId) => ({
            code: 'connector_anchor_unresolved',
            severity: 'warning' as const,
            message: `Connector anchor target ${elementId} could not be resolved.`,
            retryable: false,
            pluginId: 'agentcanvas.primitives',
            elementId: element.id
          }))
        };
      },
      renderSnapshot: (element, context) => renderConnectorSnapshot(element, context.runtime, context.theme)
    })
  )
];

const plugin: AgentCanvasServerPlugin = {
  activate(host: ServerPluginHost) {
    for (const descriptor of descriptors) host.registerElementType(descriptor);
    host.registerTool(
      tool('add-text', 'Add text', 'Add a text element to a canvas.', addTextInputSchema as JsonObject, (input) =>
        completeElement(input, 'agentcanvas.primitives/text', { text: input.text }, { width: 240, height: 100 })
      )
    );
    host.registerTool(
      tool(
        'add-shape',
        'Add shape',
        'Add a rectangle, ellipse, or diamond.',
        addShapeInputSchema as JsonObject,
        (input) =>
          completeElement(
            input,
            'agentcanvas.primitives/shape',
            { shape: input.shape, ...(input.label !== undefined ? { label: input.label } : {}) },
            { width: 240, height: 160 }
          )
      )
    );
    for (const name of ['line', 'arrow'] as const) {
      host.registerTool(
        tool(`add-${name}`, `Add ${name}`, `Add a ${name} connector.`, addConnectorInputSchema as JsonObject, (input) =>
          completeElement(
            input,
            `agentcanvas.primitives/${name}`,
            {
              from: input.from,
              to: input.to,
              ...(input.label !== undefined ? { label: input.label } : {}),
              ...(input.stroke !== undefined ? { stroke: input.stroke } : {}),
              ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {})
            },
            { width: 0, height: 0 }
          )
        )
      );
    }
    host.registerMigration({
      name: 'legacy-primitives-v1',
      legacyTypes: ['text', 'shape', 'line', 'arrow'],
      importLegacy: (element) => importLegacyPrimitive(element)
    });
  }
};

export default plugin;
