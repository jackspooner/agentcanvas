import type {
  AgentCanvasServerPlugin,
  CanvasElement,
  JsonObject,
  LegacyElementImportResult,
  SnapshotContribution
} from '@agentcanvas/plugin-sdk';
import {
  addHelloCardInputSchema,
  addHelloCardOutputSchema,
  describeCardInputSchema,
  describeCardOutputSchema,
  helloCardDataSchema,
  helloCardStyleSchema
} from './schemas.js';

const elementType = '__PLUGIN_ID__/hello-card';

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}

function numberField(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function configString(config: Readonly<JsonObject>, name: string): string {
  const value = config[name];
  if (typeof value !== 'string') throw new Error(`Required plugin configuration ${name} must be a string.`);
  return value;
}

function configInteger(config: Readonly<JsonObject>, name: string): number {
  const value = config[name];
  if (!Number.isSafeInteger(value)) throw new Error(`Required plugin configuration ${name} must be an integer.`);
  return value as number;
}

function renderSnapshot(element: Readonly<CanvasElement>): SnapshotContribution {
  const style = element.style ?? {};
  const data = element.data;
  const width = element.width ?? 320;
  const height = element.height ?? 180;
  return {
    space: 'frame',
    layer: 'content',
    nodes: [
      {
        kind: 'rect',
        x: 0,
        y: 0,
        width,
        height,
        rx: 12,
        fill: typeof style.backgroundColor === 'string' ? style.backgroundColor : '#ffffff',
        stroke: typeof style.accentColor === 'string' ? style.accentColor : '#2563eb',
        strokeWidth: 4
      },
      {
        kind: 'text',
        x: 20,
        y: 42,
        text: stringField(data.title, 'title'),
        fill: typeof style.textColor === 'string' ? style.textColor : '#111827',
        fontSize: 24,
        fontWeight: 700,
        maxWidth: width - 40
      },
      {
        kind: 'text',
        x: 20,
        y: 78,
        text: stringField(data.message, 'message'),
        fill: typeof style.textColor === 'string' ? style.textColor : '#374151',
        fontSize: 16,
        maxWidth: width - 40
      }
    ]
  };
}

function importLegacy(element: Readonly<Record<string, unknown>>): LegacyElementImportResult {
  const data: JsonObject = {
    title: stringField(element.title, 'title'),
    message: stringField(element.message, 'message')
  };
  return {
    element: {
      id: stringField(element.id, 'id'),
      type: elementType,
      schemaVersion: 1,
      x: numberField(element.x, 'x'),
      y: numberField(element.y, 'y'),
      width: typeof element.width === 'number' ? element.width : 320,
      height: typeof element.height === 'number' ? element.height : 180,
      data
    }
  };
}

const plugin: AgentCanvasServerPlugin = {
  activate(host) {
    host.registerElementType({
      name: 'hello-card',
      schemaVersion: 1,
      dataSchema: helloCardDataSchema,
      styleSchema: helloCardStyleSchema,
      defaultFrame: { width: 320, height: 180 },
      browser: true,
      snapshot: 'supported',
      validate(element) {
        const message = element.data.message;
        const maxLength = configInteger(host.config, 'maxMessageLength');
        return typeof message === 'string' && message.length > maxLength
          ? [
              {
                path: '/data/message',
                code: 'message_too_long',
                message: `Message exceeds configured limit ${maxLength}.`
              }
            ]
          : [];
      },
      summarize(element) {
        return {
          title: stringField(element.data.title, 'title'),
          detail: stringField(element.data.message, 'message')
        };
      },
      renderSnapshot
    });

    host.registerTool({
      name: 'add-hello-card',
      title: 'Add Hello Card',
      description: 'Adds a complete current-version Hello Card element to a canvas.',
      inputSchema: addHelloCardInputSchema,
      outputSchema: addHelloCardOutputSchema,
      annotations: { idempotentHint: false, destructiveHint: false, openWorldHint: false },
      async invoke(input, context) {
        const element: CanvasElement = {
          id: stringField(input.id, 'id'),
          type: elementType,
          schemaVersion: 1,
          x: numberField(input.x, 'x'),
          y: numberField(input.y, 'y'),
          width: 320,
          height: 180,
          data: {
            title: stringField(input.title, 'title'),
            message: stringField(input.message, 'message')
          },
          style: { accentColor: configString(host.config, 'accentColor') }
        };
        const canvas = await context.canvas.upsertElement(stringField(input.canvasId, 'canvasId'), element);
        return { canvas };
      }
    });

    host.registerProcedure({
      name: 'describe-card',
      description: 'Returns a deterministic summary of Hello Card data.',
      inputSchema: describeCardInputSchema,
      outputSchema: describeCardOutputSchema,
      async invoke(input) {
        const title = stringField(input.title, 'title');
        const message = stringField(input.message, 'message');
        return { summary: `${title}: ${message}`, characterCount: title.length + message.length };
      }
    });

    host.registerMigration({
      name: 'legacy-hello-card-v1',
      legacyTypes: ['helloCard'],
      importLegacy
    });
  }
};

export default plugin;
export { importLegacy, renderSnapshot };
