# Editor architecture

## Package boundary

The polished interaction layer lives in `@agentcanvas/editor`.

The package owns:

- the React Flow adapter;
- viewport conversion;
- node projection from canonical elements;
- selection state;
- editor chrome for movement and resize;
- keyboard and pointer interaction normalization;
- command dispatch and history primitives;
- world underlay and overlay portals.

The host application owns:

- canvas loading and refresh;
- canonical `CanvasDocument` state;
- HTTP mutation execution;
- revision conflict reconciliation;
- browser extension discovery and renderer activation;
- diagnostics and read-only route policy.

Extensions own:

- element content;
- plugin-specific data and style;
- declared commands, tools, inspectors, importers, and exporters;
- optional runtime and snapshot projections.

## Dependency rule

`@agentcanvas/editor` MAY depend on React, React Flow, and public AgentCanvas
contracts. Root application code and extensions MUST NOT import React Flow.

This creates one replaceable adapter boundary:

```text
CanvasDocument
  -> AgentCanvas editor projection
  -> React Flow nodes and viewport
  -> canonical CanvasOperation[]
  -> revision-aware HTTP batch
  -> CanvasDocument
```

## Projection model

Each node-placed `CanvasElement` maps to exactly one transient editor node:

- node ID equals element ID;
- position equals element `x` and `y`;
- dimensions use element width/height or the extension default frame;
- `locked` controls drag and resize;
- `zIndex`, rotation, and opacity remain element-frame properties;
- plugin data is passed through only as renderer input.

World underlay and overlay renderers use editor viewport portals and are not
represented as draggable React Flow nodes.

React Flow edge records MUST NOT be persisted. Connector elements remain normal
extension-owned elements and use the geometry service.

## Coordinate systems

Persisted elements use world coordinates. Persisted viewport state uses world
center plus zoom. React Flow uses screen translation plus zoom.

For a viewport of `width` by `height`:

```text
flowX = width / 2 - centerX * zoom
flowY = height / 2 - centerY * zoom
centerX = (width / 2 - flowX) / zoom
centerY = (height / 2 - flowY) / zoom
```

Conversion MUST be centralized and unit tested. Wheel zoom MUST preserve the
world point beneath the pointer.

## Mutation pipeline

The editor emits one or more canonical `CanvasOperation` values. The host sends
them through `POST /api/v1/canvases/:canvasId/elements:batch` with the confirmed
revision.

The host MUST:

1. apply the edit optimistically;
2. serialize mutations per canvas;
3. send the confirmed revision as `expectedRevision`;
4. replace optimistic state with the returned canonical canvas;
5. restore confirmed state and refresh after failure;
6. report revision conflicts distinctly from validation or availability
   failures.

Continuous pointer movement is local-only. A drag or resize gesture commits one
batch when the gesture ends.

## History

History records canonical forward and inverse operations, not React Flow change
objects. A history entry contains:

- a stable label;
- forward operations;
- inverse operations derived from the confirmed pre-edit document;
- affected element IDs;
- timestamp and optional merge key.

Undo applies inverse operations as a new revision. Redo reapplies forward
operations. Remote or agent revisions clear redo and end history merging.

## Performance targets

- Initial editor interaction remains responsive with 500 typical DOM elements.
- The editor uses visible-element culling where it does not break world
  renderers or accessibility.
- Pointer movement does not issue network requests before gesture completion.
- Registry loading and plugin renderer lifecycle remain one mount per stable
  element type and ID.
