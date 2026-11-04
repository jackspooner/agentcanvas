import type { ImageSourceReference, JsonObject } from '@agentcanvas/extension-sdk';
import type { MediaToolsClient } from 'media-tools-mcp/client';

export type BindingTarget =
  | { kind: 'image'; x: number; y: number; width?: number; height?: number; elementId?: string }
  | { kind: 'append'; elementId: string; itemId?: string }
  | { kind: 'replace'; elementId: string; itemId: string };

export interface BindInput {
  bindingId: string;
  canvasId: string;
  runId: string;
  outputIndex?: number;
  target: BindingTarget;
  caption?: string;
  alt?: string;
}

export type BindingStatus = 'attaching' | 'queued' | 'running' | 'collected' | 'completed' | 'failed' | 'superseded';

export interface BindingRecord {
  request: BindInput;
  elementId: string;
  itemId: string;
  status: BindingStatus;
  expectedSource?: ImageSourceReference;
  file?: Awaited<ReturnType<MediaToolsClient['imageJob']>>['files'][number];
  source?: ImageSourceReference;
  error?: { code: string; message: string; retryable: boolean };
  nextAttemptAt: number;
  backoffMs: number;
}

export interface MediaToolsConfig {
  baseUrl: string;
  outputDirectory: string;
  filesystemRootId: string;
}

export function bindingSource(bindingId: string): ImageSourceReference {
  return { provider: 'agentcanvas.mediatools', reference: { bindingId } };
}

export function publicBinding(record: BindingRecord): JsonObject {
  return {
    bindingId: record.request.bindingId,
    canvasId: record.request.canvasId,
    runId: record.request.runId,
    outputIndex: record.request.outputIndex ?? 0,
    elementId: record.elementId,
    itemId: record.itemId,
    status: record.status,
    ...(record.error ? { error: record.error } : {}),
    ...(record.source ? { source: record.source as unknown as JsonObject } : {})
  };
}
