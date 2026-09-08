import type { ElementTypeDescriptor, ServerPluginHost } from '@agentcanvas/plugin-sdk';
import { resolveElementFrame, resolveFrameAnchor } from '@agentcanvas/plugin-sdk';
import { expect, it } from 'vitest';
import primitives from '../plugin-packages/primitives/src/server.mjs';
import { projectElement } from '../packages/editor/src/projection';
import { PluginElementValidator } from '../src/plugin-runtime/elements';
import type { FrozenPluginRegistry } from '../src/plugin-runtime/registry';
import { resolveCanvasProjection } from '../src/api-v2/canvas-projection';
import { collectSnapshotItems } from '../src/snapshot-runtime/render';
import type { V2CanvasRecord } from '../src/store/v2';

it('keeps accepted null-sized primitive frames and anchors identical in editor, server and snapshot output', async () => {
  const descriptors: ElementTypeDescriptor[] = [];
  await primitives.activate({
    registerElementType: (value: ElementTypeDescriptor) => descriptors.push(value),
    registerTool: () => {},
    registerMigration: () => {}
  } as unknown as ServerPluginHost);
  const registry = {
    plugins: [{ plugin: { manifest: { id: 'agentcanvas.primitives' } }, elements: descriptors }],
    getElementType: (type: string) =>
      descriptors.find((descriptor) => type === `agentcanvas.primitives/${descriptor.name}`)
  } as unknown as FrozenPluginRegistry;
  const validator = new PluginElementValidator(registry);
  const target = validator.normalizeForWrite({
    id: 'target',
    type: 'agentcanvas.primitives/shape',
    schemaVersion: 1,
    x: 10,
    y: 20,
    width: null,
    height: null,
    data: { shape: 'rect' }
  });
  const original = structuredClone(target);
  const anchors = ['center', 'top', 'right', 'bottom', 'left'] as const;
  const arrows = anchors.map((anchor) =>
    validator.normalizeForWrite({
      id: anchor,
      type: 'agentcanvas.primitives/arrow',
      schemaVersion: 1,
      x: 0,
      y: 0,
      data: { from: { elementId: 'target', anchor }, to: { x: 500, y: 500 } }
    })
  );
  const canvas = { id: 'geometry', elements: [target, ...arrows] } as V2CanvasRecord;
  const projection = await resolveCanvasProjection(canvas, registry, false, new AbortController().signal);
  const frame = resolveElementFrame(target);
  expect(projectElement(target)).toMatchObject({ position: { x: 10, y: 20 }, width: 240, height: 120 });
  expect(resolveFrameAnchor(frame)).toEqual({ x: 130, y: 80 });
  for (const anchor of anchors)
    expect(projection.elementRuntime[anchor].connectorGeometry).toMatchObject({
      from: resolveFrameAnchor(frame, anchor)
    });
  const snapshots = await collectSnapshotItems({
    canvasId: canvas.id,
    elements: canvas.elements,
    registry,
    elementRuntime: projection.elementRuntime
  });
  expect(snapshots[0].contribution?.nodes[0]).toMatchObject({ kind: 'rect', width: 240, height: 120 });
  expect(snapshots.every((item) => item.status === 'supported')).toBe(true);
  expect(target).toEqual(original);
  expect(resolveElementFrame({ x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  expect(resolveElementFrame({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 240, height: 120 });
});
