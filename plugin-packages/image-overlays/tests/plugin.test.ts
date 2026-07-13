import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  AssetsCapabilityV1,
  ElementTypeDescriptor,
  JsonObject,
  PluginProcedureDescriptor,
  PluginToolDescriptor,
  ResourceRegistration,
  ServerPluginHost,
  SnapshotResourcesCapabilityV1
} from '@agentcanvas/plugin-sdk';
import { validatePluginManifestStructure } from '@agentcanvas/plugin-testkit';
import Ajv2020Module from 'ajv/dist/2020.js';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { maskFilename, maskFolderName, maskZipFilename, pngFilename } from '../src/exports.js';
import { scaleBBox } from '../src/geometry.js';
import { importLegacyImageOverlay } from '../src/legacy.js';
import plugin from '../src/server.mjs';
import * as schemas from '../src/schemas.js';
import { renderBBoxSnapshot, renderPathSnapshot } from '../src/snapshot.js';

const assets: AssetsCapabilityV1 = {
  validateReference(value) {
    return value as ReturnType<AssetsCapabilityV1['validateReference']>;
  },
  async boundedJson() {
    return {
      schema: 'bbox-layout/v1',
      canvasWidth: 100,
      canvasHeight: 200,
      boxes: [{ id: 'face', x: 10, y: 20, width: 30, height: 40, label: 'Face' }]
    };
  },
  async contentHandle() {
    return {
      handle: 'opaque-image',
      url: '/api/v1/resources/opaque-image/content',
      mimeType: 'image/png',
      byteLength: 12,
      width: 100,
      height: 200
    };
  },
  async details() {
    return {};
  },
  async providerStatus() {
    return { ok: true, identity: 'asset-service', capabilities: ['asset_crud', 'asset_refs'] };
  }
};

function registrations() {
  const elements: ElementTypeDescriptor[] = [];
  const tools: PluginToolDescriptor[] = [];
  const procedures: PluginProcedureDescriptor[] = [];
  const migrations: Array<{ name: string; legacyTypes: readonly string[] }> = [];
  const resourceRegistrations: ResourceRegistration[] = [];
  const emit = vi.fn();
  const resources: SnapshotResourcesCapabilityV1 = {
    register(registration) {
      const index = resourceRegistrations.push(registration);
      return {
        handle: `resource-${index}`,
        url: `/api/v1/resources/resource-${index}/content`,
        mimeType: registration.mimeType,
        ...(registration.byteLength !== undefined ? { byteLength: registration.byteLength } : {}),
        ...(registration.width !== undefined ? { width: registration.width } : {}),
        ...(registration.height !== undefined ? { height: registration.height } : {}),
        ...(registration.sha256 !== undefined ? { sha256: registration.sha256 } : {})
      };
    },
    details: () => null,
    load: async () => null
  };
  const host = {
    registerElementType: (value: ElementTypeDescriptor) => elements.push(value),
    registerTool: (value: PluginToolDescriptor) => tools.push(value),
    registerProcedure: (value: PluginProcedureDescriptor) => procedures.push(value),
    registerMigration: (value: { name: string; legacyTypes: readonly string[] }) => migrations.push(value),
    consumeCapability: (name: string, range: string) => ({
      name,
      range,
      get: () => (name === 'agentcanvas.assets' ? assets : resources),
      readiness: async () => ({ ok: true })
    }),
    provideCapability: vi.fn(),
    config: {},
    kv: {},
    diagnostics: { emit }
  } as unknown as ServerPluginHost;
  plugin.activate(host);
  return { elements, tools, procedures, migrations, emit, resourceRegistrations };
}

describe('image overlays plugin', () => {
  it('ships a conforming manifest and exact registrations', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'agentcanvas.plugin.json'), 'utf8'));
    expect(validatePluginManifestStructure(manifest)).toEqual({ ok: true, issues: [] });
    expect(manifest.requires.capabilities).toEqual({
      'agentcanvas.assets': '^1.0.0',
      'agentcanvas.snapshot-resources': '^1.0.0'
    });
    const result = registrations();
    expect(result.elements.map((item) => item.name)).toEqual(['bbox', 'path']);
    expect(result.tools.map((item) => item.name)).toEqual(['add-bbox', 'add-path', 'export-png', 'export-mask-zip']);
    expect(result.procedures.map((item) => item.name)).toEqual(['export-png', 'export-mask-zip']);
    expect(result.migrations.map(({ name, legacyTypes }) => ({ name, legacyTypes }))).toEqual([
      { name: 'legacy-image-overlays-v1', legacyTypes: ['bboxOverlay', 'pathOverlay'] }
    ]);
  });

  it('compiles every public schema under strict JSON Schema 2020-12 validation', () => {
    const ajv = new Ajv2020Module.default({ strict: true, allErrors: true, useDefaults: false });
    for (const schema of Object.values(schemas)) expect(() => ajv.compile(schema)).not.toThrow();
  });

  it('imports both legacy types while explicitly auditing runtime-only fields', () => {
    const bbox = importLegacyImageOverlay({
      id: 'bbox_1',
      type: 'bboxOverlay',
      x: 1,
      y: 2,
      canvasWidth: 100,
      canvasHeight: 200,
      boxes: [{ id: 'face', x: 10, y: 20, width: 30, height: 40 }],
      resolvedUrl: 'runtime',
      layoutResolutionError: 'runtime-error'
    });
    expect(bbox.element).toMatchObject({
      type: 'agentcanvas.image-overlays/bbox',
      schemaVersion: 1,
      data: { canvasWidth: 100, canvasHeight: 200 }
    });
    expect(bbox.strippedFields).toEqual(['layoutResolutionError', 'resolvedUrl']);
    const path = importLegacyImageOverlay({
      id: 'path_1',
      type: 'pathOverlay',
      x: 0,
      y: 0,
      canvasWidth: 50,
      canvasHeight: 50,
      paths: [{ id: 'outline', d: 'M0 0 L50 50' }]
    });
    expect(path.element.type).toBe('agentcanvas.image-overlays/path');
  });

  it('uses shared geometry in bounded scene snapshots', () => {
    const box = { id: 'face', x: 10, y: 20, width: 30, height: 40, label: 'Face', labelAlign: 'center' as const };
    expect(scaleBBox(box, 0, 100, 200, 200, 100)).toMatchObject({
      scaledX: 20,
      scaledY: 10,
      scaledWidth: 60,
      scaledHeight: 20,
      labelX: 50
    });
    const bbox = renderBBoxSnapshot(
      {
        id: 'bbox_1',
        type: 'agentcanvas.image-overlays/bbox',
        schemaVersion: 1,
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        data: { canvasWidth: 100, canvasHeight: 200, boxes: [box] }
      },
      null
    );
    expect(JSON.stringify(bbox)).not.toContain('<svg');
    expect(JSON.stringify(bbox)).toContain('Face');
    const path = renderPathSnapshot({
      id: 'path_1',
      type: 'agentcanvas.image-overlays/path',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: {
        canvasWidth: 100,
        canvasHeight: 100,
        paths: [{ id: 'outline', d: 'M0 0 L100 100', label: 'Outline' }]
      }
    });
    expect(JSON.stringify(path)).toContain('Outline');
  });

  it('treats boundedJson as decoded layout content and exposes deterministic opaque PNG resources', async () => {
    const result = registrations();
    const bbox = result.elements.find((item) => item.name === 'bbox') as ElementTypeDescriptor;
    const resolution = await bbox.resolve?.(
      {
        id: 'bbox_1',
        type: 'agentcanvas.image-overlays/bbox',
        schemaVersion: 1,
        x: 0,
        y: 0,
        data: { layoutAssetRef: { type: 'asset', project: 'demo', assetId: 'layout' } }
      },
      {
        signal: new AbortController().signal,
        canvasId: 'canvas_1',
        readOnly: true,
        geometry: { getElementFrame: () => null, resolveAnchor: () => null }
      }
    );
    expect(resolution?.runtime).toMatchObject({ canvasWidth: 100, canvasHeight: 200, boxes: [{ id: 'face' }] });

    const procedure = result.procedures.find((item) => item.name === 'export-png') as PluginProcedureDescriptor;
    const output = await procedure.invoke(
      { canvasId: 'canvas_1', elementId: 'bbox_1' },
      {
        signal: new AbortController().signal,
        correlationId: 'test',
        canvas: {
          get: async () => ({
            elements: [
              {
                id: 'bbox_1',
                type: 'agentcanvas.image-overlays/bbox',
                data: { canvasWidth: 100, canvasHeight: 200, boxes: [] }
              }
            ]
          }),
          upsertElement: vi.fn(),
          replaceElementData: vi.fn(),
          deleteElement: vi.fn()
        }
      }
    );
    expect(output).toMatchObject({
      ok: true,
      export: {
        kind: 'png',
        filename: 'bbox-1-100x200.png',
        resource: {
          handle: 'resource-1',
          url: '/api/v1/resources/resource-1/content',
          mimeType: 'image/png',
          width: 100,
          height: 200,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      },
      diagnostics: []
    });
    const outputValidator = new Ajv2020Module.default({ strict: true }).compile(schemas.exportOutputSchema);
    expect(outputValidator(output), outputValidator.errors?.map((issue) => issue.message).join('; ')).toBe(true);
    const registration = result.resourceRegistrations[0] as ResourceRegistration;
    const payload = await registration.load(new AbortController().signal);
    expect([...payload.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(payload.bytes.byteLength).toBe(registration.byteLength);
    expect(JSON.stringify(output)).not.toMatch(/(?:base64|data:|browserRequired)/i);
    expect(pngFilename('BBox 1', 100, 200)).toBe('bbox-1-100x200.png');
    expect(maskZipFilename('BBox 1', 100, 200)).toBe('bbox-1-100x200-masks.zip');
    expect(maskFolderName('BBox 1', 100, 200)).toBe('bbox-1-100x200-masks');
    expect(maskFilename(1, 'Main Face')).toBe('02-main-face.png');
  });

  it('rasterizes SVG path commands into a PNG resource', async () => {
    const result = registrations();
    const procedure = result.procedures.find((item) => item.name === 'export-png') as PluginProcedureDescriptor;
    const output = await procedure.invoke(
      { canvasId: 'canvas_1', elementId: 'path_1' },
      {
        signal: new AbortController().signal,
        correlationId: 'test',
        canvas: {
          get: async () => ({
            elements: [
              {
                id: 'path_1',
                type: 'agentcanvas.image-overlays/path',
                data: {
                  canvasWidth: 32,
                  canvasHeight: 24,
                  paths: [
                    {
                      id: 'outline',
                      d: 'M2 12 C6 2 14 2 18 12 S28 22 30 12 A4 4 0 0 1 26 16 Z',
                      color: '#2563eb',
                      fill: '#2563eb22'
                    }
                  ]
                }
              }
            ]
          }),
          upsertElement: vi.fn(),
          replaceElementData: vi.fn(),
          deleteElement: vi.fn()
        }
      }
    );
    expect(output).toMatchObject({
      export: {
        kind: 'png',
        filename: 'path-1-32x24.png',
        resource: { mimeType: 'image/png', width: 32, height: 24 }
      },
      diagnostics: []
    });
    const payload = await (result.resourceRegistrations[0] as ResourceRegistration).load(new AbortController().signal);
    expect([...payload.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('returns a deterministic mask ZIP through an opaque resource handle', async () => {
    const result = registrations();
    const procedure = result.procedures.find((item) => item.name === 'export-mask-zip') as PluginProcedureDescriptor;
    const output = await procedure.invoke(
      { canvasId: 'canvas_1', elementId: 'bbox_1' },
      {
        signal: new AbortController().signal,
        correlationId: 'test',
        canvas: {
          get: async () => ({
            elements: [
              {
                id: 'bbox_1',
                type: 'agentcanvas.image-overlays/bbox',
                data: {
                  canvasWidth: 20,
                  canvasHeight: 10,
                  boxes: [{ id: 'face', label: 'Main Face', x: 2, y: 3, width: 4, height: 5 }]
                }
              }
            ]
          }),
          upsertElement: vi.fn(),
          replaceElementData: vi.fn(),
          deleteElement: vi.fn()
        }
      }
    );
    expect(output).toMatchObject({
      export: {
        kind: 'mask-zip',
        filename: 'bbox-1-20x10-masks.zip',
        resource: { mimeType: 'application/zip', byteLength: expect.any(Number) }
      },
      diagnostics: []
    });
    const registration = result.resourceRegistrations[0] as ResourceRegistration;
    const first = await registration.load(new AbortController().signal);
    const second = await registration.load(new AbortController().signal);
    expect(first.bytes).toEqual(second.bytes);
    const zip = await JSZip.loadAsync(first.bytes);
    expect(Object.keys(zip.files)).toEqual(['bbox-1-20x10-masks/01-main-face.png']);
    const mask = await zip.file('bbox-1-20x10-masks/01-main-face.png')?.async('uint8array');
    expect(mask && [...mask.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('surfaces export failures through structured diagnostics', async () => {
    const result = registrations();
    const procedure = result.procedures.find((item) => item.name === 'export-mask-zip') as PluginProcedureDescriptor;
    await expect(
      procedure.invoke(
        { canvasId: 'missing', elementId: 'bbox_missing' },
        {
          signal: new AbortController().signal,
          correlationId: 'test',
          canvas: {
            get: async () => ({ elements: [] }),
            upsertElement: vi.fn(),
            replaceElementData: vi.fn(),
            deleteElement: vi.fn()
          }
        }
      )
    ).rejects.toThrow('overlay element was not found');
    expect(result.emit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'mask_zip_export_failed', severity: 'error', elementId: 'bbox_missing' })
    );
  });
});
