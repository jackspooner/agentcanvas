# AgentCanvas extension API reference

New extensions should import `@agentcanvas/extension-sdk`.
`@agentcanvas/plugin-sdk` remains the compatible plugin API v1 contract.
Extensions must not import root AgentCanvas source, private React components,
React Flow, Hono, or SQLite.

## Typed definition

`defineExtension`, `defineElement`, and `defineCommand` create one typed
authoring descriptor. Build tooling serializes
`definition.manifest` to the static `agentcanvas.plugin.json` installed by the
host. Host discovery never executes the descriptor.

## Server activation

```ts
interface AgentCanvasServerPlugin {
  activate(host: ServerPluginHost): void | Promise<void>;
}
```

`ServerPluginHost` exposes registration for element types, tools, procedures, migrations, and capabilities; consumption of declared capabilities; validated read-only config; plugin-namespaced KV; and scoped diagnostics.

The public `ImageSourcesCapabilityV1` is the provider-neutral image boundary. Source extensions call `registerProvider`; consumers call `validateReference` and `resolve` with `{ provider, reference }` envelopes. Resolvers return only `OpaqueResourceHandle` values, and the host rejects non-image MIME types. The registry deliberately supports several providers inside one host capability because capability names themselves remain singleton-owned.

`CanvasThemeV1` is the stable semantic design-token contract. `RendererContext.theme` and
`SnapshotRendererContext.theme` expose the same complete resolved theme. The SDK helpers `themedString` and
`themedNumber` implement explicit element style first, then theme token resolution.

## Element descriptor

An `ElementTypeDescriptor` declares:

- local `name` and current positive `schemaVersion`;
- JSON Schema 2020-12 for `data` and optional `style`;
- optional default frame;
- browser and snapshot declarations;
- optional contiguous schema migrations;
- optional cross-field validation;
- compact summary generation;
- optional async runtime projection with diagnostics;
- optional safe snapshot renderer.

The runtime projection context includes abort signal, canvas ID, read-only state, and read-only element frame/anchor geometry.

## Tools and procedures

Tools have local name, title, description, input/output JSON Schemas, optional MCP annotations, and an async invocation function. Procedures have local name, description, schemas, and invocation.

Invocation context contains an abort signal, correlation ID, and scoped canvas operations:

- read a canvas;
- upsert a complete element;
- replace one element's data/style;
- delete an element.

Each mutation has a receipt form for MCP-facing tools. Receipt methods return
only canvas ID, revision, and whole-canvas diagnostic counts. The original
methods remain compatible and return the full document projection.

The SDK does not expose arbitrary HTTP route registration, middleware, raw authentication state, SQLite, or unrestricted filesystem helpers.

HTTP procedures run through the host route, strict input/output Ajv validation, request security policy, and a 30-second abort deadline. MCP tools use the same descriptor schemas and validate both input and output.

## Legacy migrations

A plugin migration declares a local migration name, owned legacy types, and a pure importer. The offline host extracts the common envelope. Importers return canonical plugin `data` and optional `style`; they must not contact external services or mutate input.

## KV

KV keys match a bounded safe-key pattern. Values must be finite JSON and at most 256 KiB serialized. Lists are ordered and limited to 100 entries per page. KV is unavailable before the runtime binds the database.

## Browser activation

Browser entries default-export `AgentCanvasBrowserPlugin` and register framework-neutral `BrowserElementRenderer` objects. See [Browser plugin runtime](plugin-browser-runtime.md).

A renderer may declare an optional `details` hook. The host then renders the
standard node-level Details button and calls `details.open` with the current
renderer context. Extensions must fetch only safe projections, use the host
overlay service, honor the abort signal, and avoid exposing provider-local
paths or credentials.

Renderer contexts distinguish short-lived operation cancellation from the
renderer lifetime. `signal` aborts superseded mount/update work;
`lifecycle.signal` remains stable through updates and aborts on disposal.
`lifecycle.active` and `lifecycle.reducedMotion` are delivered through the
serialized update path. `frames.subscribe` uses the host's shared,
activity-gated browser clock and starts or resumes with `deltaMs: 0`. Frame
callbacks are browser-local and cannot create document mutations, revisions,
history, persistence, or network operations. Server and snapshot contexts do
not expose the scheduler.

Browser entries may also register declared `BrowserCommandDescriptor` values.
Command IDs are namespaced as `<extension-id>.<local-name>`. A command receives:

- read-only selected element snapshots;
- current viewport and a `reveal` operation;
- the shared command dispatcher;
- extension-owned element transactions;
- overlays and scoped diagnostics;
- an abort signal.

Host API `1.2.0` adds JSON command inputs (`execute(context, input?)`) and
`hidden: true` for internal commands that remain callable without appearing in
the extension menu. `context.getElement?(id)` returns a cloned, current confirmed
owned element plus its canvas revision, or `null`. `context.theme` contains the
same resolved canvas theme as renderers. Call
`context.transact(label, operations, { expectedRevision })` to reject stale edits;
the revision, ownership, existence, and lock checks run inside the shared save
queue, and undo captures the confirmed pre-save state. Read-only commands may
still open overlays or export; transactions reject read-only canvases.

Renderer contexts optionally expose `canvasRevision` and
`executeCommand(id, input?)`. Renderer dispatch is bound to its originating
canvas and element, overwrites `input.elementId`, and permits only the owning
extension's registered commands plus `agentcanvas.undo` and `agentcanvas.redo`.
Disposed or superseded renderer contexts cannot dispatch, and retained command
contexts cannot transact after their renderer lifetime ends or the canvas changes.
Renderer command eligibility and execution receive the originating element as
their selection. `context.signal` combines the canvas and renderer lifetimes;
ordinary renderer updates do not abort open command dialogs. Retained command
contexts expose current `readOnly` and `theme` values through getters.
`context.canvasRevision` reads the current confirmed revision, including on an
empty canvas, so creation commands can also supply `expectedRevision`.

The context deliberately does not expose React Flow or host-private React
state. Activation may return a disposable, which the browser registry invokes
once during teardown.

## Snapshot scene

Snapshot renderers return typed `SnapshotContribution` values. See [Snapshot plugin runtime](plugin-snapshot-runtime.md).

## Current limitations

- Plugin invocation canvas operations intentionally do not expose frame or metadata replacement directly; plugin tools normally replace owned data or upsert complete owned elements.
- Permissions constrain supported host services but do not sandbox trusted server or browser code.
