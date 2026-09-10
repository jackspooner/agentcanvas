import type { CanvasElement, CanvasInspectionSummary, PluginDiagnostic } from '@agentcanvas/plugin-sdk';
import type { FrozenPluginRegistry } from './registry.js';
import { DEFAULT_DIAGNOSTICS_CONFIGURATION, type DiagnosticsConfiguration } from '../configuration.js';

export interface InspectableCanvas {
  id: string;
  elements: readonly CanvasElement[];
}

export interface CanvasInspection {
  diagnostics: PluginDiagnostic[];
  summary: CanvasInspectionSummary;
}

/**
 * Runs plugin-owned, read-only quality checks against persisted element data.
 * These diagnostics are advisory: schema and invariant enforcement remains in
 * the write validator, while rendered/network verification remains external.
 */
export function inspectCanvasElements(
  canvas: InspectableCanvas,
  registry: FrozenPluginRegistry,
  options: Readonly<DiagnosticsConfiguration> = DEFAULT_DIAGNOSTICS_CONFIGURATION
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  for (const element of canvas.elements) {
    const split = element.type.lastIndexOf('/');
    const pluginId = element.type.slice(0, split);
    const descriptor = registry.getElementType(element.type);
    if (!descriptor) {
      diagnostics.push({
        code: 'plugin_unavailable',
        severity: 'warning',
        message: `No active plugin owns ${element.type}.`,
        retryable: false,
        pluginId,
        elementId: element.id
      });
      continue;
    }
    const issues = descriptor.inspect?.(element, {
      pluginId,
      type: element.type,
      schemaVersion: element.schemaVersion
    });
    for (const issue of issues ?? []) {
      diagnostics.push({
        code: issue.code,
        severity: 'warning',
        message: `${issue.path || '/'}: ${issue.message}`,
        retryable: false,
        pluginId,
        elementId: element.id
      });
    }
  }
  if (options.overlapMode === 'off') return diagnostics;
  let overlapCount = 0;
  const framed = canvas.elements.filter(
    (element) =>
      typeof element.width === 'number' &&
      element.width > 0 &&
      typeof element.height === 'number' &&
      element.height > 0 &&
      !element.type.endsWith('/line') &&
      !element.type.endsWith('/arrow')
  );
  // ponytail: pairwise scan; bounded mode stops on excess warnings. Use a spatial index if sparse canvases become slow.
  for (let leftIndex = 0; leftIndex < framed.length; leftIndex += 1) {
    const left = framed[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < framed.length; rightIndex += 1) {
      const right = framed[rightIndex];
      if (left.metadata?.allowOverlap === true || right.metadata?.allowOverlap === true) continue;
      const overlapWidth =
        Math.min(left.x + (left.width as number), right.x + (right.width as number)) - Math.max(left.x, right.x);
      const overlapHeight =
        Math.min(left.y + (left.height as number), right.y + (right.height as number)) - Math.max(left.y, right.y);
      if (overlapWidth <= 0 || overlapHeight <= 0) continue;
      if (options.overlapMode === 'bounded' && overlapCount === options.maxOverlapWarnings) {
        diagnostics.push({
          code: 'overlap_diagnostics_truncated',
          severity: 'info',
          message: `Overlap inspection stopped after ${overlapCount} warnings. More overlaps exist; change Diagnostics settings to increase the limit or report all.`,
          retryable: false
        });
        return diagnostics;
      }
      overlapCount += 1;
      diagnostics.push({
        code: 'element_frames_overlap',
        severity: 'warning',
        message: `Frame overlaps ${left.id} by ${Math.round(overlapWidth)}×${Math.round(overlapHeight)} world pixels. Move or resize one frame, or persist metadata.allowOverlap=true when layering is deliberate.`,
        retryable: false,
        elementId: right.id
      });
    }
  }
  return diagnostics;
}

/** Returns the diagnostics and severity counts used by both mutation responses and explicit inspection. */
export function inspectCanvas(
  canvas: InspectableCanvas,
  registry: FrozenPluginRegistry,
  options: Readonly<DiagnosticsConfiguration> = DEFAULT_DIAGNOSTICS_CONFIGURATION
): CanvasInspection {
  const diagnostics = inspectCanvasElements(canvas, registry, options);
  return {
    diagnostics,
    summary: {
      errorCount: diagnostics.filter((item) => item.severity === 'error').length,
      warningCount: diagnostics.filter((item) => item.severity === 'warning').length,
      infoCount: diagnostics.filter((item) => item.severity === 'info').length
    }
  };
}
