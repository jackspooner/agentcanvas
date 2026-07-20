import type {
  CanvasElement,
  CanvasThemeV1,
  ElementTypeDescriptor,
  JsonObject,
  PluginDiagnostic,
  SnapshotContribution
} from '@agentcanvas/plugin-sdk';
import { DEFAULT_CANVAS_THEME } from '@agentcanvas/plugin-sdk';
import type { SnapshotRenderItem } from './compositor.js';

export interface SnapshotDescriptorRegistry {
  getElementType(type: string): Pick<ElementTypeDescriptor, 'snapshot' | 'renderSnapshot'> | undefined;
}

export interface CollectSnapshotItemsOptions {
  canvasId: string;
  elements: readonly Readonly<CanvasElement>[];
  elementRuntime?: Readonly<Record<string, JsonObject>>;
  registry: SnapshotDescriptorRegistry;
  signal?: AbortSignal;
  rendererTimeoutMs?: number;
  theme?: Readonly<CanvasThemeV1>;
}

function safeFailureDiagnostic(
  element: Readonly<CanvasElement>,
  code: 'snapshot_renderer_failed' | 'snapshot_renderer_timeout'
): PluginDiagnostic {
  return {
    code,
    severity: 'error',
    message:
      code === 'snapshot_renderer_timeout'
        ? `Snapshot renderer timed out for ${element.type}.`
        : `Snapshot renderer failed for ${element.type}.`,
    retryable: code === 'snapshot_renderer_timeout',
    pluginId: element.type.slice(0, element.type.lastIndexOf('/')),
    elementId: element.id
  };
}

async function renderWithDeadline(
  renderer: NonNullable<ElementTypeDescriptor['renderSnapshot']>,
  element: Readonly<CanvasElement>,
  runtime: Readonly<JsonObject> | null,
  theme: Readonly<CanvasThemeV1>,
  canvasId: string,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<SnapshotContribution> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(renderer(element, { signal: controller.signal, canvasId, runtime, theme })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error('snapshot renderer timeout'));
          reject(new DOMException('Snapshot renderer timed out', 'TimeoutError'));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

export async function collectSnapshotItems(
  options: CollectSnapshotItemsOptions
): Promise<readonly SnapshotRenderItem[]> {
  const timeoutMs = options.rendererTimeoutMs ?? 2_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError('rendererTimeoutMs must be an integer from 1 through 30000');
  }
  return Promise.all(
    options.elements.map(async (element): Promise<SnapshotRenderItem> => {
      const descriptor = options.registry.getElementType(element.type);
      if (!descriptor) return { element, status: 'missing' };
      if (descriptor.snapshot === 'unsupported') return { element, status: 'unsupported' };
      if (!descriptor.renderSnapshot) {
        return {
          element,
          status: 'failed',
          diagnostic: safeFailureDiagnostic(element, 'snapshot_renderer_failed')
        };
      }
      try {
        const contribution = await renderWithDeadline(
          descriptor.renderSnapshot,
          element,
          options.elementRuntime?.[element.id] ?? null,
          options.theme ?? DEFAULT_CANVAS_THEME,
          options.canvasId,
          options.signal,
          timeoutMs
        );
        return { element, status: 'supported', contribution };
      } catch (error) {
        return {
          element,
          status: 'failed',
          diagnostic: safeFailureDiagnostic(
            element,
            error instanceof DOMException && error.name === 'TimeoutError'
              ? 'snapshot_renderer_timeout'
              : 'snapshot_renderer_failed'
          )
        };
      }
    })
  );
}
