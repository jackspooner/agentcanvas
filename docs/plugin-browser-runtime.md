# AgentCanvas browser extension runtime

## Delivery

The server hashes every file in the declared browser entry's directory tree and returns a same-origin build-hash URL. Module requests require the active plugin ID and current hash, reject traversal and links, and serve only contained files with exact known MIME mappings, immutable cache, `nosniff`, and same-origin resource policy.

The browser validates that the URL is unadorned, same-origin, and matches catalog identity/hash before dynamic import. Browser bundles must include their dependencies and use contained relative chunks/assets.

## Renderer contract

```ts
interface BrowserElementRenderer {
  type: `${string}/${string}`;
  schemaVersions: readonly number[];
  placement: "node" | "world-underlay" | "world-overlay";
  details?: {
    label?: string;
    open(context: RendererContext): void | Promise<void>;
  };
  mount(root: ShadowRoot, context: RendererContext): {
    update(next: RendererContext): void | Promise<void>;
    dispose(): void | Promise<void>;
  };
}
```

`RendererContext.signal` belongs to the current mount or update operation and
may abort when a newer update is queued. `RendererContext.lifecycle.signal` is
stable for the renderer's lifetime and aborts only when the host disposes or
fails that renderer. `RendererContext.lifecycle.active` reports whether the
surface is mounted, connected, intersecting the visible browser viewport, and
in a visible document. `reducedMotion` is the host's current media preference.

`RendererContext.frames` is a stable renderer-lifetime scheduler:

```ts
interface RendererFrame {
  timestamp: number;
  deltaMs: number;
}

interface RendererFrameScheduler {
  subscribe(callback: (frame: RendererFrame) => void): () => void;
}
```

All renderers share one browser animation clock. Subscribers receive frames
only while their renderer is active. The first frame and first frame after
reactivation have `deltaMs: 0`; no fixed frame rate is guaranteed.
Subscriptions are removed automatically on disposal. A callback that throws is
removed on its own and produces `browser_renderer_frame_failed` without
stopping other callbacks. Subscription changes made during a frame take effect
on the next frame.

Node renderers may opt into the shared Details affordance. The editor owns the
button and its interaction isolation; the extension receives a current
`RendererContext` and owns the safe metadata projection plus overlay content.
Abort-aware implementations must close their overlay when `context.signal`
fires. World renderers may declare the hook, but the current editor only
presents it for node placements.

The browser activation host exposes `registerRenderer` and, when supported,
`registerCommand`. Existing browser extensions that only register renderers
remain valid.

## Commands

The installed manifest declares local command names under
`contributes.commands`. Browser activation must register exactly those names.
The host exposes them through the same command service used by toolbar and
keyboard actions.

Commands receive selection snapshots, read-only state, viewport state,
`reveal`, command dispatch, extension-owned transactions, overlays,
diagnostics, and an abort signal. Transactions may upsert, replace data/style,
or delete only elements owned by the registering extension. They participate
in canonical revision-aware undo and redo.

## Activation disposal

Browser activation may return `{ dispose() }`. The registry calls it exactly
once when the application tears down or replaces the registry. Renderers still
own their per-element `mount`/`update`/`dispose` lifecycle separately.

## Host responsibilities

- create the outer frame and open ShadowRoot;
- own frame position, size, rotation, opacity, z-index, selection, movement, locking, and read-only state;
- provide CSS theme tokens, read-only geometry, an overlay service, diagnostics, operation/lifetime abort signals, activity, reduced-motion state, and the shared frame scheduler;
- mount once per element ID/type/renderer and update on context changes;
- abort prior work, serialize updates, and dispose once;
- catch mount/update/dispose failures and render a diagnostic card;
- preserve an external drag handle for editable unlocked node renderers;
- present one consistent Details button for node renderers that opt in;
- use `event.composedPath()` for interactive-region detection.

Native controls and elements marked `data-agentcanvas-interactive` do not initiate pan/selection. World renderers are pointer-transparent and receive geometry rather than DOM access.

## Plugin responsibilities

- render content only inside the supplied ShadowRoot;
- honor `readOnly`, operation `signal`, renderer `lifecycle`, and current `schemaVersion`;
- render a stable state instead of motion when `lifecycle.reducedMotion` is true;
- mark custom interactive regions;
- close host overlays and release media/object URLs/listeners during update or dispose;
- avoid reading host-private DOM or React state;
- report safe diagnostics without secrets or paths.

## Isolation and failure behavior

Shadow DOM provides style and lifecycle isolation, not security. If browser activation fails, the plugin receives `browser_plugin_activation_failed` and its elements use kernel diagnostic cards; other plugins remain active.

Current limitation: the host aborts and serializes updates, but a renderer that ignores its abort signal can still complete stale work before the queued update runs. Plugins must implement abort-aware async work.

Frames are ephemeral browser state. They do not mutate canvas data, create
revisions or history, persist, or perform network operations. The frame
scheduler is not available to server or snapshot renderers.
