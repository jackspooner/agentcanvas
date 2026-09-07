import type { CanvasElement } from '@agentcanvas/plugin-sdk';
import { expect, it } from 'vitest';
import { extensionOperations, frameOperations } from '../src/web/canvas-operations';

it('builds inverse frame changes without unchanged fields or empty operations', () => {
  const before = { x: 0, y: 1, width: 40, height: 60 };
  expect(
    frameOperations([
      { elementId: 'one', before, after: { ...before, x: 20 } },
      { elementId: 'two', before, after: before }
    ])
  ).toEqual({
    forward: [{ op: 'patchElementFrame', elementId: 'one', frame: { x: 20 } }],
    inverse: [{ op: 'patchElementFrame', elementId: 'one', frame: { x: 0 } }]
  });
});

it('enforces extension ownership and reverses multiple changes in inverse order', () => {
  const element: CanvasElement = {
    id: 'one',
    type: 'fixture.cards/card',
    schemaVersion: 1,
    x: 0,
    y: 0,
    data: { title: 'before' }
  };
  const document = { elements: [element] };
  const original = structuredClone(document);
  const result = extensionOperations(document, 'fixture.cards', [
    { op: 'replaceElementData', elementId: 'one', data: { title: 'after' } },
    { op: 'deleteElement', elementId: 'one' }
  ]);
  expect(result.inverse).toEqual([
    { op: 'upsertElement', element: { ...element, data: { title: 'after' } } },
    { op: 'replaceElementData', elementId: 'one', data: { title: 'before' }, style: null }
  ]);
  expect(document).toEqual(original);
  expect(() => extensionOperations(document, 'other', [{ op: 'deleteElement', elementId: 'one' }])).toThrow(
    'cannot mutate'
  );
  expect(() =>
    extensionOperations(document, 'other', [{ op: 'upsertElement', element: { ...element, type: 'other/card' } }])
  ).toThrow('cannot replace');
});
