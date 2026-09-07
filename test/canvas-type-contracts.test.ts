import type { CanvasBatchRequest, CanvasOperation, CanvasRecord } from '@agentcanvas/core';
import { expectTypeOf, it } from 'vitest';
import type { V2CanvasBatchRequest, V2CanvasOperation, V2CanvasRecord } from '../src/store/v2.js';
import type { CanvasDocument, CanvasProjection } from '../src/web/v2-types.js';

it('preserves compatibility aliases to the canonical canvas contracts', () => {
  expectTypeOf<V2CanvasRecord>().toEqualTypeOf<CanvasRecord>();
  expectTypeOf<CanvasDocument>().toEqualTypeOf<CanvasRecord>();
  expectTypeOf<CanvasProjection['canvas']>().toEqualTypeOf<CanvasRecord>();
  expectTypeOf<V2CanvasOperation>().toEqualTypeOf<CanvasOperation>();
  expectTypeOf<V2CanvasBatchRequest>().toEqualTypeOf<CanvasBatchRequest>();
  expectTypeOf<Record<string, unknown>>().toExtend<Extract<CanvasOperation, { op: 'replaceElementData' }>['data']>();
  expectTypeOf<Record<string, unknown>>().toExtend<
    Extract<CanvasOperation, { op: 'replaceElementMetadata' }>['metadata']
  >();
});
