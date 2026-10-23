import { describe, expect, it, vi } from 'vitest';
import type {
  FilesystemImageAdmissionCapabilityV1,
  GalleryAuthoringCapabilityV1,
  ImageSourceReference,
  NamespacedPluginKv,
  PluginDiagnostics
} from '@agentcanvas/extension-sdk';
import type { MediaToolsClient, ImageJobOutput } from 'media-tools-mcp/client';
import { MediaToolsClientError } from 'media-tools-mcp/client';
import { BindingWorker } from '../src/worker.js';
import { bindingSource, type BindingRecord, type BindInput, type MediaToolsConfig } from '../src/contracts.js';

const config: MediaToolsConfig = {
  baseUrl: 'http://media.test',
  outputDirectory: 'C:/outputs',
  filesystemRootId: 'generated'
};
const receipt = {
  canvasId: 'canvas',
  revision: 2,
  inspectionSummary: { errorCount: 0, warningCount: 0, infoCount: 0 }
};
const file = { path: 'C:/outputs/result.png' } as ImageJobOutput['files'][number];
const source: ImageSourceReference = { provider: 'agentcanvas.filesystem-images', reference: { id: 'saved-image' } };

class MemoryKv implements NamespacedPluginKv {
  values = new Map<string, any>();
  failNext?: (key: string, value: any) => boolean;
  failAlways?: (key: string, value: any) => boolean;

  async get(key: string) {
    return structuredClone(this.values.get(key));
  }
  async set(key: string, value: any) {
    if (this.failAlways?.(key, value)) throw new Error('simulated storage outage');
    if (this.failNext?.(key, value)) {
      this.failNext = undefined;
      throw new Error('simulated write interruption');
    }
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async list({ prefix = '', cursor, limit = 100 }: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const entries = [...this.values]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => !cursor || key > cursor)
      .slice(0, limit)
      .map(([key, value]) => ({ key, value: structuredClone(value) }));
    const nextCursor = entries.length === limit ? entries.at(-1)?.key : undefined;
    return { entries, ...(nextCursor ? { nextCursor } : {}) };
  }
}

function fixture(job: any = { status: 'queued', files: [] }) {
  const kv = new MemoryKv();
  const items = new Map<string, ImageSourceReference | null>();
  const key = (elementId: string, itemId: string) => `${elementId}/${itemId}`;
  const gallery = {
    create: vi.fn(async (input: any) => {
      items.set(key(input.id, input.items[0].id), structuredClone(input.items[0].source));
      return receipt;
    }),
    append: vi.fn(async (input: any) => {
      items.set(key(input.elementId, input.items[0].id), structuredClone(input.items[0].source));
      return receipt;
    }),
    getItem: vi.fn(async (_canvasId: string, elementId: string, itemId: string) => ({
      source: structuredClone(items.get(key(elementId, itemId)) ?? null),
      revision: 1
    })),
    replaceSource: vi.fn(async (input: any) => {
      const id = key(input.elementId, input.itemId);
      if (!isSame(items.get(id) ?? null, input.expectedSource)) return { changed: false };
      items.set(id, structuredClone(input.source));
      return { changed: true, receipt };
    })
  } as unknown as GalleryAuthoringCapabilityV1;
  const files = {
    fromPath: vi.fn(async () => structuredClone(source))
  } as unknown as FilesystemImageAdmissionCapabilityV1;
  const client = {
    imageJob: vi.fn(async () => structuredClone(job))
  } as unknown as MediaToolsClient;
  const diagnostics = { emit: vi.fn() } as unknown as PluginDiagnostics;
  const controller = new AbortController();
  const worker = () => new BindingWorker(kv, gallery, files, client, config, controller.signal, diagnostics);
  return { kv, items, gallery, files, client, diagnostics, worker, controller };
}

function isSame(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const imageInput = (overrides: Partial<BindInput> = {}): BindInput => ({
  bindingId: 'bind1',
  canvasId: 'canvas',
  runId: 'run1',
  target: { kind: 'image', x: 12, y: 34 },
  ...overrides
});

describe('MediaTools binding worker', () => {
  it('stops polling a cancelled job and keeps its binding as a terminal failure', async () => {
    const f = fixture({ status: 'cancelled', files: [] });
    await f.worker().bind(imageInput(), f.controller.signal);
    await f.worker().tick();
    expect(await f.worker().get('bind1')).toMatchObject({
      status: 'failed',
      error: { code: 'mediatools_job_cancelled' }
    });
    await f.worker().tick();
    expect(f.client.imageJob).toHaveBeenCalledTimes(1);
    expect(f.files.fromPath).not.toHaveBeenCalled();
    expect(f.gallery.replaceSource).not.toHaveBeenCalled();
  });

  it('reserves a default image frame, tracks running state, and attaches the selected output', async () => {
    const f = fixture({ status: 'running', files: [] });
    const bound = await f
      .worker()
      .bind(imageInput({ outputIndex: 1, caption: 'A view', alt: 'mountain' }), f.controller.signal);
    expect((bound as any).binding).toMatchObject({
      outputIndex: 1,
      status: 'queued',
      elementId: 'bind1',
      itemId: 'bind1'
    });
    expect(f.gallery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 12,
        y: 34,
        width: 320,
        height: 240,
        fit: 'contain',
        showControls: false,
        showIndicators: false,
        items: [{ id: 'bind1', source: bindingSource('bind1'), caption: 'A view', alt: 'mountain' }]
      }),
      f.controller.signal
    );
    await f.worker().tick();
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'running' });

    (f.client.imageJob as any).mockResolvedValueOnce({
      status: 'completed',
      files: [{ path: 'C:/outputs/first.png' }, file]
    });
    await f.worker().tick();
    expect(f.files.fromPath).toHaveBeenCalledWith(file.path, config.filesystemRootId, f.controller.signal);
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'completed', file, source });
    expect(f.items.get('bind1/bind1')).toEqual(source);
  });

  it('preserves explicit frame dimensions and supports append and compare-and-replace targets', async () => {
    const f = fixture();
    await f
      .worker()
      .bind(
        imageInput({ bindingId: 'sized', target: { kind: 'image', x: 1, y: 2, width: 640, height: 480 } }),
        f.controller.signal
      );
    expect(f.gallery.create).toHaveBeenCalledWith(
      expect.objectContaining({ width: 640, height: 480 }),
      expect.anything()
    );

    await f
      .worker()
      .bind(
        imageInput({ bindingId: 'append1', target: { kind: 'append', elementId: 'carousel' } }),
        f.controller.signal
      );
    expect(f.gallery.append).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'carousel', items: [{ id: 'append1', source: bindingSource('append1') }] }),
      expect.anything()
    );

    const old = { provider: 'example.images', reference: { id: 'old' } };
    f.items.set('carousel/item1', old);
    await f
      .worker()
      .bind(
        imageInput({ bindingId: 'replace1', target: { kind: 'replace', elementId: 'carousel', itemId: 'item1' } }),
        f.controller.signal
      );
    expect(f.gallery.replaceSource).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSource: old, source: bindingSource('replace1') }),
      expect.anything()
    );
  });

  it('returns the existing binding for identical retries and rejects conflicting reuse', async () => {
    const f = fixture();
    const worker = f.worker();
    await worker.bind(imageInput(), f.controller.signal);
    const retry = await worker.bind(imageInput(), f.controller.signal);
    expect((retry as any).binding.status).toBe('queued');
    expect(f.gallery.create).toHaveBeenCalledTimes(1);
    await expect(worker.bind(imageInput({ runId: 'other-run' }), f.controller.signal)).rejects.toThrow(
      'Binding ID already has different inputs.'
    );
  });

  it('recovers an attaching record after the canvas write committed but its state save failed', async () => {
    const f = fixture();
    f.kv.failNext = (key, value) => key === 'binding/bind1' && value.status === 'queued';
    await expect(f.worker().bind(imageInput(), f.controller.signal)).rejects.toThrow('simulated write interruption');
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'attaching' });
    await f.worker().tick(true);
    expect(f.gallery.create).toHaveBeenCalledTimes(1);
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'queued' });
  });

  it('promotes a collected output after restart without polling the job again', async () => {
    const f = fixture();
    const request = imageInput();
    f.kv.values.set('binding/bind1', {
      request,
      elementId: 'bind1',
      itemId: 'bind1',
      status: 'collected',
      file,
      nextAttemptAt: 0,
      backoffMs: 5000
    } satisfies BindingRecord);
    f.items.set('bind1/bind1', bindingSource('bind1'));
    await f.worker().tick();
    expect(f.client.imageJob).not.toHaveBeenCalled();
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'completed', source });
  });

  it('keeps an admitted output retryable when saving its source is interrupted', async () => {
    const f = fixture({ status: 'completed', files: [file] });
    await f.worker().bind(imageInput(), f.controller.signal);
    f.kv.failNext = (key, value) => key === 'binding/bind1' && value.status === 'collected' && Boolean(value.source);
    await f.worker().tick();
    expect(await f.worker().get('bind1')).toMatchObject({
      status: 'collected',
      file,
      source,
      error: { code: 'mediatools_unavailable', retryable: true }
    });

    await f.worker().tick(true);
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'completed', source });
    expect(f.client.imageJob).toHaveBeenCalledTimes(1);
    expect(f.files.fromPath).toHaveBeenCalledTimes(1);
  });

  it('finishes bookkeeping after a canvas commit whose completed-state save was interrupted', async () => {
    const f = fixture({ status: 'completed', files: [file] });
    await f.worker().bind(imageInput(), f.controller.signal);
    f.kv.failAlways = (key, value) => key === 'binding/bind1' && value.status === 'completed';
    await f.worker().tick();
    expect(f.items.get('bind1/bind1')).toEqual(source);
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'collected', file, source });

    f.kv.failAlways = undefined;
    await f.worker().tick(true);
    expect(await f.worker().get('bind1')).toMatchObject({ status: 'completed', source });
    expect(f.gallery.replaceSource).toHaveBeenCalledTimes(1);
    expect(f.client.imageJob).toHaveBeenCalledTimes(1);
  });

  it('retries a revision conflict and marks removed or rebound targets superseded', async () => {
    const f = fixture({ status: 'completed', files: [file] });
    const worker = f.worker();
    await worker.bind(imageInput(), f.controller.signal);
    (f.gallery.replaceSource as any).mockRejectedValueOnce(
      Object.assign(new Error('stale revision'), { code: 'revision_conflict' })
    );
    await worker.tick();
    expect(await worker.get('bind1')).toMatchObject({ status: 'collected', file, source });
    await worker.tick();
    expect(await worker.get('bind1')).toMatchObject({ status: 'completed' });

    await worker.bind(imageInput({ bindingId: 'gone' }), f.controller.signal);
    f.items.set('gone/gone', { provider: 'example.images', reference: { id: 'replacement' } });
    await worker.bind(imageInput({ bindingId: 'deleted' }), f.controller.signal);
    f.items.delete('deleted/deleted');
    await worker.tick();
    expect(await worker.get('gone')).toMatchObject({ status: 'superseded' });
    expect(await worker.get('deleted')).toMatchObject({ status: 'superseded' });
  });

  it('backs off transient failures, terminally rejects invalid output, and polls each run once', async () => {
    const f = fixture();
    await f.worker().bind(imageInput(), f.controller.signal);
    await f.worker().bind(imageInput({ bindingId: 'bind2' }), f.controller.signal);
    (f.client.imageJob as any).mockRejectedValueOnce(
      new MediaToolsClientError('transport', 'connection_lost', true, 'The response was lost.')
    );
    await f.worker().tick();
    expect(await f.worker().get('bind1')).toMatchObject({
      error: { retryable: true },
      nextAttemptAt: expect.any(Number),
      backoffMs: 10000
    });
    expect(f.client.imageJob).toHaveBeenCalledTimes(1);
    await f.worker().tick(true);
    expect(f.client.imageJob).toHaveBeenCalledTimes(2);
    const request = { runId: 'run1', destination: config.outputDirectory, returnInline: false };
    expect(f.client.imageJob).toHaveBeenNthCalledWith(1, request, { signal: f.controller.signal });
    expect(f.client.imageJob).toHaveBeenNthCalledWith(2, request, { signal: f.controller.signal });
    expect(f.client.imageJob).toHaveBeenLastCalledWith(
      { runId: 'run1', destination: config.outputDirectory, returnInline: false },
      { signal: f.controller.signal }
    );

    (f.client.imageJob as any).mockResolvedValueOnce({ status: 'completed', files: [file] });
    await f.worker().tick(true);
    expect(await f.worker().get('bind2')).toMatchObject({ status: 'completed' });
  });

  it('caps exponential retry backoff at 30 seconds', async () => {
    const f = fixture();
    await f.worker().bind(imageInput(), f.controller.signal);
    (f.client.imageJob as any).mockRejectedValue(new Error('offline'));
    const worker = f.worker();
    for (const backoffMs of [10_000, 20_000, 30_000, 30_000, 30_000]) {
      await worker.tick(true);
      expect(await worker.get('bind1')).toMatchObject({ backoffMs, error: { retryable: true } });
    }
  });

  it('fails closed when Filesystem Images rejects a collected path and when the job has failed', async () => {
    const f = fixture({ status: 'failed', files: [] });
    await f.worker().bind(imageInput(), f.controller.signal);
    await f.worker().tick();
    expect(await f.worker().get('bind1')).toMatchObject({
      status: 'failed',
      error: { code: 'mediatools_job_failed', retryable: false }
    });

    const rejected = fixture({ status: 'completed', files: [file] });
    (rejected.files.fromPath as any).mockRejectedValue(new Error('outside configured root'));
    await rejected.worker().bind(imageInput(), rejected.controller.signal);
    await rejected.worker().tick();
    expect(await rejected.worker().get('bind1')).toMatchObject({
      status: 'failed',
      error: { code: 'mediatools_output_rejected', retryable: false }
    });
  });

  it('treats an expired MediaTools job as a terminal binding failure', async () => {
    const f = fixture();
    (f.client.imageJob as any).mockRejectedValue(
      new MediaToolsClientError('tool', 'job_expired', false, 'The job has expired.')
    );
    await f.worker().bind(imageInput(), f.controller.signal);
    await f.worker().tick();
    expect(await f.worker().get('bind1')).toMatchObject({
      status: 'failed',
      error: { code: 'mediatools_job_unavailable', retryable: false }
    });
  });
});
