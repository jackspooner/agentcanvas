import { describe, expect, it } from 'vitest';
import {
  analyzeLegacyElement,
  canonicalizeLegacyElement,
  copyLegacyDataFields,
  LEGACY_TYPE_DEFINITIONS
} from '../src/migrations/legacy';

describe('legacy element migration', () => {
  it('maps every supported legacy type to its canonical plugin type', () => {
    expect(LEGACY_TYPE_DEFINITIONS.asset.targetType).toBe('agentcanvas.assets2/asset');
    expect(LEGACY_TYPE_DEFINITIONS.markdown.targetType).toBe('agentcanvas.markdown/document');
    expect(LEGACY_TYPE_DEFINITIONS.glbViewer.targetType).toBe('agentcanvas.glb-viewer/model');
    expect(LEGACY_TYPE_DEFINITIONS.group.targetType).toBeNull();
  });

  it('blocks groups and unknown fields while auditing runtime projections', () => {
    const group = analyzeLegacyElement('canvas_a', { id: 'group_1', type: 'group', x: 0, y: 0, children: [] });
    expect(group.groupBlockers).toEqual([{ canvasId: 'canvas_a', elementId: 'group_1' }]);
    expect(group.issues[0]?.code).toBe('group_element_present');

    const asset = analyzeLegacyElement('canvas_a', {
      id: 'asset_1',
      type: 'asset',
      x: 0,
      y: 0,
      assetRef: { type: 'asset', project: 'p', assetId: 'a' },
      resolvedUrl: 'http://runtime-only',
      surprise: true
    });
    expect(asset.runtimeFields).toEqual([
      { canvasId: 'canvas_a', elementId: 'asset_1', legacyType: 'asset', field: 'resolvedUrl' }
    ]);
    expect(asset.issues).toContainEqual(
      expect.objectContaining({ code: 'unexpected_legacy_field', field: 'surprise' })
    );
  });

  it('uses an owning plugin importer and never includes runtime fields in its input', () => {
    const input = {
      id: 'asset_1',
      type: 'asset',
      x: 12,
      y: 34,
      width: 320,
      style: { borderRadius: 4 },
      metadata: { preserved: true },
      assetRef: { type: 'asset', project: 'p', assetId: 'a' },
      caption: 'Hello',
      resolvedUrl: 'http://runtime-only'
    };
    const canonical = canonicalizeLegacyElement(input, {
      legacyType: 'asset',
      targetType: 'agentcanvas.assets2/asset',
      schemaVersion: 1,
      import(element) {
        expect(element).not.toHaveProperty('resolvedUrl');
        return { data: copyLegacyDataFields(element, LEGACY_TYPE_DEFINITIONS.asset.dataFields) };
      }
    });
    expect(canonical).toEqual({
      id: 'asset_1',
      type: 'agentcanvas.assets2/asset',
      schemaVersion: 1,
      x: 12,
      y: 34,
      width: 320,
      style: { borderRadius: 4 },
      metadata: { preserved: true },
      data: {
        assetRef: { type: 'asset', project: 'p', assetId: 'a' },
        caption: 'Hello'
      }
    });
  });
});
