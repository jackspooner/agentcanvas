import type { CanvasElement, JsonObject, PluginDiagnostic } from '@agentcanvas/plugin-sdk';
import { type FrozenPluginRegistry, inspectCanvasElements } from '../plugin-runtime/index.js';
import type { V2CanvasRecord } from '../store/v2.js';

function anchorPoint(
  element: Readonly<CanvasElement>,
  anchor: 'center' | 'top' | 'right' | 'bottom' | 'left' = 'center'
): { x: number; y: number } {
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  if (anchor === 'top') return { x: element.x + width / 2, y: element.y };
  if (anchor === 'right') return { x: element.x + width, y: element.y + height / 2 };
  if (anchor === 'bottom') return { x: element.x + width / 2, y: element.y + height };
  if (anchor === 'left') return { x: element.x, y: element.y + height / 2 };
  return { x: element.x + width / 2, y: element.y + height / 2 };
}

export async function resolveCanvasProjection(
  canvas: V2CanvasRecord,
  registry: FrozenPluginRegistry,
  readOnly: boolean,
  signal: AbortSignal
): Promise<{ elementRuntime: Record<string, JsonObject>; diagnostics: PluginDiagnostic[] }> {
  const elementRuntime: Record<string, JsonObject> = {};
  const diagnostics: PluginDiagnostic[] = inspectCanvasElements(canvas, registry);
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
              return target ? { x: target.x, y: target.y, width: target.width ?? 0, height: target.height ?? 0 } : null;
            },
            resolveAnchor(elementId, anchor) {
              const target = elements.get(elementId);
              return target ? anchorPoint(target, anchor) : null;
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
