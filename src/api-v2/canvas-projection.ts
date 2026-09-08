import {
  resolveElementFrame,
  resolveFrameAnchor,
  type JsonObject,
  type PluginDiagnostic
} from '@agentcanvas/plugin-sdk';
import { type FrozenPluginRegistry, inspectCanvasElements } from '../plugin-runtime/index.js';
import type { V2CanvasRecord } from '../store/v2.js';
import { DEFAULT_DIAGNOSTICS_CONFIGURATION, type DiagnosticsConfiguration } from '../configuration.js';

export async function resolveCanvasProjection(
  canvas: V2CanvasRecord,
  registry: FrozenPluginRegistry,
  readOnly: boolean,
  signal: AbortSignal,
  diagnosticsConfiguration: Readonly<DiagnosticsConfiguration> = DEFAULT_DIAGNOSTICS_CONFIGURATION
): Promise<{ elementRuntime: Record<string, JsonObject>; diagnostics: PluginDiagnostic[] }> {
  const elementRuntime: Record<string, JsonObject> = {};
  const diagnostics: PluginDiagnostic[] = inspectCanvasElements(canvas, registry, diagnosticsConfiguration);
  const elements = new Map(canvas.elements.map((element) => [element.id, element]));
  for (const element of canvas.elements) {
    const descriptor = registry.getElementType(element.type);
    if (!descriptor) continue;
    let runtime: JsonObject = {};
    if (descriptor.resolve) {
      try {
        const resolved = await descriptor.resolve(element, {
          signal,
          canvasId: canvas.id,
          readOnly,
          geometry: {
            getElementFrame(elementId) {
              const target = elements.get(elementId);
              return target ? resolveElementFrame(target) : null;
            },
            resolveAnchor(elementId, anchor) {
              const target = elements.get(elementId);
              return target ? resolveFrameAnchor(resolveElementFrame(target), anchor) : null;
            }
          }
        });
        runtime = { ...runtime, ...resolved.runtime };
        diagnostics.push(...(resolved.diagnostics ?? []));
      } catch {
        diagnostics.push({
          code: 'element_resolution_failed',
          severity: 'error',
          message: `Runtime projection failed for ${element.type}.`,
          retryable: true,
          pluginId: element.type.slice(0, element.type.lastIndexOf('/')),
          elementId: element.id
        });
      }
    }
    if (Object.keys(runtime).length) elementRuntime[element.id] = runtime;
  }
  return { elementRuntime, diagnostics };
}
