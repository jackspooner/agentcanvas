import fs from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, OpaqueResourceHandle, SnapshotResourcesCapabilityV1 } from '@agentcanvas/plugin-sdk';
import type { FileSystemImageSource, FileSystemImagesConfig } from './contracts.js';

const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

interface ResolvedImage {
  canonicalPath: string;
  mimeType: string;
  byteLength: number;
  mtimeMs: number;
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function normalizeRelativeImagePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('filesystem image path must be a non-empty relative path');
  }
  const parts = value.split('/');
  if (
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('filesystem image path must be normalized, slash-separated, and relative');
  }
  if (!MIME_TYPES.has(path.extname(value).toLowerCase())) {
    throw new Error('filesystem image must use png, jpeg, webp, gif, or avif');
  }
  return value;
}

export function readFileSystemImagesConfig(value: Readonly<JsonObject>): FileSystemImagesConfig {
  const config = value as unknown as FileSystemImagesConfig;
  if (!Array.isArray(config.roots) || config.roots.length > 64) {
    throw new Error('filesystem image roots must be an array of at most 64 entries');
  }
  if (
    !Number.isSafeInteger(config.contentMaxBytes) ||
    config.contentMaxBytes < 1024 ||
    config.contentMaxBytes > 536_870_912
  ) {
    throw new Error('filesystem image contentMaxBytes is invalid');
  }
  if (!Number.isSafeInteger(config.resourceTtlMs) || config.resourceTtlMs < 1000 || config.resourceTtlMs > 86_400_000) {
    throw new Error('filesystem image resourceTtlMs is invalid');
  }
  const ids = new Set<string>();
  for (const root of config.roots) {
    if (!root || typeof root !== 'object') throw new Error('filesystem image root is invalid');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(root.id)) throw new Error('filesystem image root ID is invalid');
    if (ids.has(root.id)) throw new Error(`duplicate filesystem image root ID: ${root.id}`);
    if (typeof root.path !== 'string' || !path.isAbsolute(root.path)) {
      throw new Error(`filesystem image root ${root.id} must use an absolute path`);
    }
    ids.add(root.id);
  }
  return config;
}

export class FileSystemImageSourceResolver {
  private readonly handles = new Map<
    string,
    { fingerprint: string; resource: OpaqueResourceHandle & { byteLength: number } }
  >();

  private constructor(
    private readonly roots: ReadonlyMap<string, string>,
    private readonly contentMaxBytes: number,
    private readonly resourceTtlMs: number,
    private readonly resources: SnapshotResourcesCapabilityV1
  ) {}

  static async create(
    config: FileSystemImagesConfig,
    resources: SnapshotResourcesCapabilityV1
  ): Promise<FileSystemImageSourceResolver> {
    const roots = new Map<string, string>();
    for (const root of config.roots) {
      const canonical = await fs.realpath(root.path);
      const stat = await fs.stat(canonical);
      if (!stat.isDirectory()) throw new Error(`filesystem image root ${root.id} is not a directory`);
      roots.set(root.id, canonical);
    }
    return new FileSystemImageSourceResolver(roots, config.contentMaxBytes, config.resourceTtlMs, resources);
  }

  listRoots(): readonly { id: string }[] {
    return Object.freeze([...this.roots.keys()].sort().map((id) => Object.freeze({ id })));
  }

  async fromPath(absolutePath: string, rootId: string, signal: AbortSignal): Promise<FileSystemImageSource> {
    signal.throwIfAborted();
    const root = this.roots.get(rootId);
    if (!root || !path.isAbsolute(absolutePath)) throw new Error('filesystem image file is not admitted');
    const canonicalPath = await fs.realpath(absolutePath);
    if (!containedBy(root, canonicalPath)) throw new Error('filesystem image file is outside its configured root');
    const source = this.validateSource({ rootId, path: path.relative(root, canonicalPath).split(path.sep).join('/') });
    await this.resolve(source, signal);
    return source;
  }

  validateSource(value: unknown): FileSystemImageSource {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('filesystem image source is invalid');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => key !== 'rootId' && key !== 'path')) {
      throw new Error('filesystem image source contains unsupported fields');
    }
    if (typeof input.rootId !== 'string' || !this.roots.has(input.rootId)) {
      throw new Error('filesystem image source root is not allowlisted');
    }
    return { rootId: input.rootId, path: normalizeRelativeImagePath(input.path) };
  }

  async resource(sourceValue: unknown, signal: AbortSignal): Promise<OpaqueResourceHandle & { byteLength: number }> {
    const source = this.validateSource(sourceValue);
    const initial = await this.resolve(source, signal);
    const key = `${source.rootId}\0${source.path}`;
    const fingerprint = `${initial.canonicalPath}\0${initial.mimeType}\0${initial.byteLength}\0${initial.mtimeMs}`;
    const cached = this.handles.get(key);
    if (cached?.fingerprint === fingerprint && this.resources.details(cached.resource.handle)) return cached.resource;
    const handle = this.resources.register({
      mimeType: initial.mimeType,
      mutable: true,
      ttlMs: this.resourceTtlMs,
      load: async (loadSignal) => {
        const current = await this.resolve(source, loadSignal);
        if (current.mimeType !== initial.mimeType) throw new Error('filesystem image MIME type changed');
        const bytes = await fs.readFile(current.canonicalPath, { signal: loadSignal });
        if (bytes.byteLength > this.contentMaxBytes) throw new Error('filesystem image exceeds configured byte limit');
        return { bytes, mimeType: current.mimeType };
      }
    });
    const resource = { ...handle, byteLength: initial.byteLength };
    this.handles.set(key, { fingerprint, resource });
    return resource;
  }

  private async resolve(source: FileSystemImageSource, signal: AbortSignal): Promise<ResolvedImage> {
    signal.throwIfAborted();
    const root = this.roots.get(source.rootId);
    if (!root) throw new Error('filesystem image source root is not allowlisted');
    const relativePath = normalizeRelativeImagePath(source.path);
    const candidate = path.resolve(root, ...relativePath.split('/'));
    const canonicalPath = await fs.realpath(candidate);
    if (!containedBy(root, canonicalPath)) throw new Error('filesystem image resolves outside its allowlisted root');
    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile()) throw new Error('filesystem image source is not a regular file');
    if (stat.size > this.contentMaxBytes) throw new Error('filesystem image exceeds configured byte limit');
    const mimeType = MIME_TYPES.get(path.extname(canonicalPath).toLowerCase());
    if (!mimeType) throw new Error('filesystem image type is not allowed');
    signal.throwIfAborted();
    return { canonicalPath, mimeType, byteLength: stat.size, mtimeMs: stat.mtimeMs };
  }
}
