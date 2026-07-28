# Browser and snapshot ABI

## Browser renderers

Browser plugins are framework-neutral. They must not import the host React runtime or private UI modules. Register a `BrowserElementRenderer` whose type is the canonical `<plugin-id>/<local-name>`.

The host owns the outer frame, transforms, selection, drag handle, locking, opacity, z-order, read-only behavior, and error boundary. It mounts the renderer into a ShadowRoot and calls `update` without unnecessary remounts. The renderer owns only its content and must release media, event listeners, handles, and asynchronous work in `dispose`.

Use the `RendererContext` abort signals, lifecycle state, frame scheduler, theme tokens, read-only geometry service, diagnostic reporter, and overlay service. `signal` is scoped to the current mount or update; `lifecycle.signal` survives updates and aborts only on renderer disposal. `theme` is a complete `CanvasThemeV1`, including when the canvas has no persisted theme. Map semantic roles to its tokens and keep explicit element styles as overrides. Mark interactive controls and media with `data-agentcanvas-interactive`; host pointer handling uses the composed event path through Shadow DOM. A plugin needing a UI outside canvas clipping must use the overlay service rather than reaching into host DOM.

For element metadata, add the renderer's optional `details.open(context)` hook
instead of drawing a private button inside the ShadowRoot. The editor supplies
one consistent Details affordance. The hook should open through
`context.overlays`, close on `context.signal`, and return only a safe
user-facing projection.

Snapshot renderers receive the identical resolved theme in `SnapshotRendererContext`. Browser and snapshot
output must not maintain separate color or typography defaults.

Browser bundles execute same-origin code. Shadow DOM isolates styling and lifecycle, not security.

## Dynamic renderer recipe

An extension using the shared scheduler must require host API `^1.1.0`.
Subscribe once during `mount`, retain the latest context from `update`, and
unsubscribe during normal cleanup. The host also removes subscriptions
automatically if disposal or renderer failure interrupts cleanup.

```ts
const renderer: BrowserElementRenderer = {
  type: 'acme.monitor/frame-counter',
  schemaVersions: [1],
  placement: 'node',
  mount(root, initial) {
    const output = document.createElement('output');
    root.replaceChildren(output);
    let context = initial;
    let count = 0;

    const renderStable = () => {
      output.textContent = context.lifecycle.reducedMotion ? 'Motion paused' : `Frame ${count}`;
    };
    renderStable();

    const unsubscribe = context.frames.subscribe(({ deltaMs }) => {
      if (context.lifecycle.reducedMotion) return;
      count += 1;
      output.dataset.deltaMs = String(deltaMs);
      renderStable();
    });

    return {
      update(next) {
        context = next;
        renderStable();
      },
      dispose() {
        unsubscribe();
        root.replaceChildren();
      }
    };
  }
};
```

The host stops callbacks while the surface is offscreen, disconnected, or the
document is hidden, then resumes with `deltaMs: 0`. Do not derive persisted
state from frame count or timestamps. Motion-producing renderers must present a
stable reduced-motion state and must follow the
[W3C guidance for flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes.html).
Use `ManualRendererFrameScheduler` from `@agentcanvas/extension-testkit` for
deterministic renderer tests.

## Browser commands

Declare local command names in the generated manifest and register matching
`BrowserCommandDescriptor` objects during browser activation. Commands receive
selected element snapshots, read-only state, viewport state, `reveal`, the
shared command dispatcher, extension-owned transactions, overlays,
diagnostics, and an abort signal.

Command implementations must not import React Flow or reach into host DOM.
Transactions may mutate only elements owned by the registering extension and
join the host's canonical revision-aware undo/redo history.

Browser activation may return `{ dispose() }`. Use it to remove global event
listeners or subscriptions created during activation. Per-element renderer
cleanup remains owned by each mounted renderer.

## Snapshot renderers

Snapshot renderers return bounded scene IR. They do not return SVG, HTML, CSS, external URLs, or data URLs.

Supported nodes are `group`, `rect`, `ellipse`, `line`, `path`, `text`, and `imageHandle`. The host validates numbers, colors, paths, text, transforms, node/depth limits, and opaque resource handles before serialization. Use `imageHandle` only with a handle supplied through the snapshot-resource capability.

Choose `space: "frame"` for content transformed by the element envelope or `space: "world"` for connectors and other world geometry. Choose an `underlay`, `content`, or `overlay` layer. Renderer failure should yield a structured diagnostic; a malformed element must not prevent unrelated elements from appearing unless it exceeds a hard safety limit.

Snapshot typography is a deterministic projection, not DOM pixel parity. Share pure geometry helpers between browser and snapshot implementations when anchors, paths, or extents must match.

Continue with [Testing and distribution](testing-and-distribution.md). The detailed host behavior is documented in [Browser runtime](../plugin-browser-runtime.md) and [Snapshot runtime](../plugin-snapshot-runtime.md).
