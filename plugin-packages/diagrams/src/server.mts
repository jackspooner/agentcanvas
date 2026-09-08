import type {
  AgentCanvasServerPlugin,
  ElementResolution,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/extension-sdk';
import type { ErdData } from './contracts.js';
import { diagramGeometry } from './erd/geometry.js';
import { validateErd } from './erd/validation.js';
import { validateMermaid } from './mermaid/headless.js';
import { validateMermaidSource } from './mermaid/policy.js';
import { erdDataSchema, mermaidDataSchema } from './schemas.js';
import { renderMermaidSnapshot, renderNativeSnapshot } from './snapshot.js';
import { diagramIssues, registerDiagramTools } from './tools.js';

const extension: AgentCanvasServerPlugin = {
  activate(host) {
    const resources = host.consumeCapability<SnapshotResourcesCapabilityV1>('agentcanvas.snapshot-resources', '^1.0.0');
    host.registerElementType({
      name: 'erd',
      schemaVersion: 1,
      dataSchema: erdDataSchema,
      defaultFrame: { width: 960, height: 640 },
      browser: true,
      snapshot: 'supported',
      validate: (element) => validateErd(element.data),
      inspect(element) {
        const geometry = diagramGeometry(element.data as unknown as ErdData);
        const issues = [];
        if (
          geometry.entities.some((a, index) =>
            geometry.entities
              .slice(index + 1)
              .some((b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y)
          )
        )
          issues.push({
            path: '/data/entities',
            code: 'erd_entities_overlap',
            message: 'Some entities overlap. Move them or invoke Auto layout.'
          });
        if (
          Math.min(
            (element.width ?? 960) / Math.max(1, geometry.bounds.width),
            (element.height ?? 640) / Math.max(1, geometry.bounds.height)
          ) < 0.4
        )
          issues.push({
            path: '/width',
            code: 'erd_small_display',
            message: 'The diagram is scaled down substantially. Expand the editor or enlarge its outer frame.'
          });
        return issues;
      },
      summarize: (element) => ({ title: String(element.data.title) || 'Entity relationship diagram' }),
      renderSnapshot: (element, context) => renderNativeSnapshot(element, context.theme)
    });
    host.registerElementType({
      name: 'mermaid',
      schemaVersion: 1,
      dataSchema: mermaidDataSchema,
      defaultFrame: { width: 720, height: 480 },
      browser: true,
      snapshot: 'supported',
      snapshotTimeoutMs: 25_000,
      validate: (element) => validateMermaidSource(element.data.source as string),
      summarize: (element) => ({ title: String(element.data.title) || 'Mermaid diagram' }),
      async resolve(element, context): Promise<ElementResolution> {
        try {
          const parsed = await validateMermaid(element.data.source as string, context.signal);
          return { runtime: { syntaxValid: true, diagramType: parsed.diagramType } };
        } catch (error) {
          return {
            runtime: { syntaxValid: false },
            diagnostics: diagramIssues(error).map((issue) => ({
              ...issue,
              severity: 'error' as const,
              retryable: false,
              pluginId: 'agentcanvas.diagrams',
              elementId: element.id
            }))
          };
        }
      },
      async renderSnapshot(element, context) {
        try {
          return await renderMermaidSnapshot(element, context.theme, context.signal, resources.get());
        } catch (error) {
          return {
            space: 'frame',
            layer: 'content',
            nodes: [],
            diagnostics: diagramIssues(error).map((issue) => ({
              ...issue,
              severity: 'error' as const,
              retryable: false,
              pluginId: 'agentcanvas.diagrams',
              elementId: element.id
            }))
          };
        }
      }
    });
    registerDiagramTools(host);
  }
};
export default extension;
