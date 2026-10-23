import { isDeepStrictEqual } from 'node:util';
import type {
  CanvasMutationReceipt,
  FilesystemImageAdmissionCapabilityV1,
  GalleryAuthoringCapabilityV1,
  JsonObject,
  NamespacedPluginKv,
  PluginDiagnostics
} from '@agentcanvas/extension-sdk';
import { PluginValidationError } from '@agentcanvas/extension-sdk';
import { CanvasError } from '@agentcanvas/core/errors';
import { MediaToolsClientError, type MediaToolsClient } from 'media-tools-mcp/client';
import {
  bindingSource,
  publicBinding,
  type BindInput,
  type BindingRecord,
  type MediaToolsConfig
} from './contracts.js';

const prefix = 'binding/';
const active = new Set(['attaching', 'queued', 'running', 'collected']);
const codeOf = (error: unknown): string =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : '';

export class BindingWorker {
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastGroup = '';

  constructor(
    private readonly kv: NamespacedPluginKv,
    private readonly gallery: GalleryAuthoringCapabilityV1,
    private readonly files: FilesystemImageAdmissionCapabilityV1,
    private readonly client: MediaToolsClient,
    private readonly config: MediaToolsConfig,
    private readonly signal: AbortSignal,
    private readonly diagnostics: PluginDiagnostics
  ) {}

  // ponytail: one attachment lane; split per binding if polling delays tool calls.
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {
      this.signal.throwIfAborted();
      return operation();
    });
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async get(bindingId: string): Promise<BindingRecord | undefined> {
    this.signal.throwIfAborted();
    return (await this.kv.get(prefix + bindingId)) as unknown as BindingRecord | undefined;
  }

  private async save(record: BindingRecord): Promise<void> {
    this.signal.throwIfAborted();
    await this.kv.set(prefix + record.request.bindingId, record as unknown as JsonObject);
  }

  async list(input: { canvasId?: string; cursor?: string; limit?: number }): Promise<JsonObject> {
    const page = await this.kv.list({ prefix, cursor: input.cursor, limit: input.limit ?? 50 });
    this.signal.throwIfAborted();
    const records = page.entries.map((entry) => entry.value as unknown as BindingRecord);
    return {
      bindings: records
        .filter((record) => !input.canvasId || record.request.canvasId === input.canvasId)
        .map(publicBinding),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
    };
  }

  bind(input: BindInput, signal: AbortSignal): Promise<JsonObject> {
    return this.serial(async () => {
      signal.throwIfAborted();
      const request = { ...structuredClone(input), outputIndex: input.outputIndex ?? 0 };
      let record = await this.get(input.bindingId);
      if (record) {
        if (!isDeepStrictEqual(record.request, request))
          throw new CanvasError('idempotency_conflict', 'Binding ID already has different inputs.', 'idempotency', 409);
        const receipt = record.status === 'attaching' ? await this.attach(record, signal) : undefined;
        return { binding: publicBinding(record), ...(receipt ? { receipt } : {}) };
      }
      const target = request.target;
      record = {
        request,
        elementId: target.elementId ?? input.bindingId,
        itemId:
          target.kind === 'replace'
            ? target.itemId
            : target.kind === 'append'
              ? (target.itemId ?? input.bindingId)
              : input.bindingId,
        status: 'attaching',
        nextAttemptAt: 0,
        backoffMs: 5000
      };
      if (target.kind === 'replace') {
        const current = await this.gallery.getItem(input.canvasId, record.elementId, record.itemId, signal);
        if (!current.source) throw new PluginValidationError('The carousel item does not exist.');
        record.expectedSource = current.source;
      }
      signal.throwIfAborted();
      await this.save(record);
      const receipt = await this.attach(record, signal);
      return { binding: publicBinding(record), ...(receipt ? { receipt } : {}) };
    });
  }

  private async attach(record: BindingRecord, signal: AbortSignal): Promise<CanvasMutationReceipt | undefined> {
    const { request, elementId, itemId } = record;
    const source = bindingSource(request.bindingId);
    const current = await this.gallery.getItem(request.canvasId, elementId, itemId, signal);
    let receipt: CanvasMutationReceipt | undefined;
    if (!isDeepStrictEqual(current.source, source)) {
      const item = {
        id: itemId,
        source,
        ...(request.caption !== undefined ? { caption: request.caption } : {}),
        ...(request.alt !== undefined ? { alt: request.alt } : {})
      };
      if (request.target.kind === 'image') {
        receipt = await this.gallery.create(
          {
            canvasId: request.canvasId,
            id: elementId,
            x: request.target.x,
            y: request.target.y,
            width: request.target.width ?? 320,
            height: request.target.height ?? 240,
            items: [item] as unknown as JsonObject[],
            fit: 'contain',
            showControls: false,
            showIndicators: false
          },
          signal
        );
      } else if (request.target.kind === 'append') {
        if (current.source) throw new PluginValidationError('The carousel item ID is already in use.');
        receipt = await this.gallery.append(
          { canvasId: request.canvasId, elementId, items: [item] as unknown as JsonObject[] },
          signal
        );
      } else {
        const changed = await this.gallery.replaceSource(
          { canvasId: request.canvasId, elementId, itemId, expectedSource: record.expectedSource!, source },
          signal
        );
        if (!changed.changed) throw new PluginValidationError('The carousel item changed before attachment.');
        receipt = changed.receipt;
      }
    }
    record.status = 'queued';
    delete record.error;
    await this.save(record);
    return receipt;
  }

  private fail(record: BindingRecord, code: string, message: string): Promise<void> {
    record.status = 'failed';
    record.error = { code, message, retryable: false };
    return this.save(record);
  }

  private async stillBound(record: BindingRecord): Promise<boolean> {
    const current = await this.gallery.getItem(record.request.canvasId, record.elementId, record.itemId, this.signal);
    if (isDeepStrictEqual(current.source, bindingSource(record.request.bindingId))) return true;
    // A crash after committing the normal source must finish bookkeeping, not restore the job.
    record.status = record.source && isDeepStrictEqual(current.source, record.source) ? 'completed' : 'superseded';
    delete record.error;
    await this.save(record);
    return false;
  }

  private async promote(record: BindingRecord): Promise<void> {
    if (!record.source) {
      try {
        record.source = await this.files.fromPath(record.file!.path, this.config.filesystemRootId, this.signal);
      } catch (error) {
        this.signal.throwIfAborted();
        await this.fail(
          record,
          'mediatools_output_rejected',
          'The completed image is not admitted by Filesystem Images.'
        );
        return;
      }
      await this.save(record);
    }
    const result = await this.gallery.replaceSource(
      {
        canvasId: record.request.canvasId,
        elementId: record.elementId,
        itemId: record.itemId,
        expectedSource: bindingSource(record.request.bindingId),
        source: record.source
      },
      this.signal
    );
    record.status = result.changed ? 'completed' : 'superseded';
    delete record.error;
    await this.save(record);
  }

  private async recover(error: unknown, record: BindingRecord): Promise<void> {
    this.signal.throwIfAborted();
    if (codeOf(error) === 'revision_conflict') return;
    if (codeOf(error) === 'not_found' || codeOf(error) === 'element_not_found') {
      record.status = 'superseded';
      await this.save(record);
      return;
    }
    if (error instanceof MediaToolsClientError && !error.retryable) {
      await this.fail(
        record,
        error.kind === 'auth' ? 'mediatools_authentication_failed' : 'mediatools_job_unavailable',
        error.kind === 'auth'
          ? 'MediaTools authentication failed. Check the configured credential.'
          : 'The image job is unavailable, invalid, or expired.'
      );
      return;
    }
    if (error instanceof PluginValidationError) {
      await this.fail(record, 'mediatools_attachment_failed', error.message);
      return;
    }
    if (error instanceof CanvasError && !error.retryable) {
      await this.fail(
        record,
        'mediatools_attachment_failed',
        'The image target is invalid or cannot be changed. Inspect its frame and carousel settings.'
      );
      return;
    }
    record.error = {
      code: 'mediatools_unavailable',
      message: 'MediaTools is unavailable; this attachment will retry.',
      retryable: true
    };
    record.nextAttemptAt = Date.now() + record.backoffMs;
    record.backoffMs = Math.min(record.backoffMs * 2, 30_000);
    await this.save(record);
  }

  tick(force = false): Promise<void> {
    return this.serial(async () => {
      const records: BindingRecord[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.kv.list({ prefix, cursor, limit: 100 });
        this.signal.throwIfAborted();
        records.push(...page.entries.map((entry) => entry.value as unknown as BindingRecord));
        cursor = page.nextCursor;
      } while (cursor);
      const groups = new Map<string, BindingRecord[]>();
      for (const record of records) {
        if (!active.has(record.status) || (!force && record.nextAttemptAt > Date.now())) continue;
        try {
          if (record.status === 'attaching') await this.attach(record, this.signal);
          if (!(await this.stillBound(record))) continue;
          if (record.file) {
            await this.promote(record);
            continue;
          }
          const group = groups.get(record.request.runId) ?? [];
          group.push(record);
          groups.set(record.request.runId, group);
        } catch (error) {
          await this.recover(error, record);
        }
      }
      const keys = [...groups.keys()].sort();
      const later = keys.filter((key) => key > this.lastGroup);
      const selected = [...later, ...keys.filter((key) => key <= this.lastGroup)].slice(0, 4);
      // ponytail: four job reads per cycle; raise this ceiling only if collection throughput requires it.
      if (selected.length) this.lastGroup = selected[selected.length - 1];
      await Promise.all(
        selected.map(async (runId) => {
          const members = groups.get(runId)!;
          try {
            const job = await this.client.imageJob(
              { runId, destination: this.config.outputDirectory, returnInline: false },
              { signal: this.signal }
            );
            this.signal.throwIfAborted();
            for (const record of members) {
              try {
                record.backoffMs = 5000;
                record.nextAttemptAt = 0;
                delete record.error;
                if (job.status === 'failed') {
                  await this.fail(
                    record,
                    'mediatools_job_failed',
                    'Image generation failed. Attach a different job to try again.'
                  );
                } else if (job.status === 'cancelled') {
                  await this.fail(
                    record,
                    'mediatools_job_cancelled',
                    'Image generation was cancelled. Attach a different job to try again.'
                  );
                } else if (job.status === 'completed') {
                  const file = job.files[record.request.outputIndex ?? 0];
                  if (!file) {
                    await this.fail(
                      record,
                      'mediatools_output_missing',
                      'The selected output index does not exist in this job.'
                    );
                    continue;
                  }
                  record.file = file;
                  record.status = 'collected';
                  await this.save(record);
                  await this.promote(record);
                } else {
                  record.status = job.status;
                  await this.save(record);
                }
              } catch (error) {
                await this.recover(error, record);
              }
            }
          } catch (error) {
            for (const record of members) if (active.has(record.status)) await this.recover(error, record);
          }
        })
      );
    });
  }

  start(): void {
    const cycle = async (force = false) => {
      try {
        await this.tick(force);
      } catch {
        if (!this.signal.aborted)
          this.diagnostics.emit({
            code: 'mediatools_worker_failed',
            severity: 'error',
            message: 'MediaTools attachment reconciliation failed.',
            retryable: true
          });
      } finally {
        if (!this.signal.aborted)
          this.timer = setTimeout(() => {
            void cycle();
          }, 5000);
      }
    };
    void cycle(true);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
