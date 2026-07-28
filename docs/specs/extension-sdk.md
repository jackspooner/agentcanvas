# Extension authoring SDK

## Naming and compatibility

The public product term is **extension**. Plugin API v1 remains a supported
runtime and distribution format during v0.3.

The intended public packages are:

```text
@agentcanvas/extension-sdk
@agentcanvas/extension-testkit
create-agentcanvas-extension
@agentcanvas/extension-react
```

`@agentcanvas/plugin-sdk`, `@agentcanvas/plugin-testkit`, and
`create-agentcanvas-plugin` remain compatibility entrypoints. They MUST not be
removed or silently change persisted identifiers in v0.3.

## Single authoring descriptor

Author-maintained manifest and runtime declarations currently overlap. V0.3
introduces a typed descriptor as the source for authoring-time validation and
manifest generation:

```ts
export default defineExtension({
  manifest: {
    id: "example.cards",
    version: "1.0.0",
    displayName: "Cards",
    description: "Interactive canvas cards",
    license: "MIT"
  },
  elements: [defineElement({ /* ... */ })],
  commands: [defineCommand({ /* ... */ })]
});
```

Build tooling derives static contribution declarations from this descriptor.
The installed distribution still contains a strict, inspectable
`agentcanvas.plugin.json` manifest so startup does not execute code to discover
claims.

## Contribution points

V0.3 defines these contribution families:

- `elements`
- `commands`
- `menus`
- `keybindings`
- `canvasTools`
- `inspectors`
- `selectionActions`
- `dropHandlers`
- `pasteHandlers`
- `exporters`
- `tools`
- `procedures`
- `migrations`
- `capabilities`
- `configuration`

The first implementation wave MUST support elements and commands end to end.
Menus, keybindings, inspectors, and selection actions follow without changing
the command contract.

## Command contract

A command has:

- a globally namespaced ID;
- title and optional category;
- optional enablement predicate over editor context;
- optional declared menu and keybinding placements;
- an implementation registered during browser or server activation.

Browser command implementations receive an `EditorContext`, not a React Flow
instance. The context exposes:

- selected element IDs and read-only selection snapshots;
- viewport read and reveal operations;
- command execution;
- extension-owned element transactions;
- overlays;
- diagnostics;
- an abort signal and disposable lifecycle.

Permissions continue to gate supported host services. They are not a sandbox.

## Browser lifecycle

Browser activation returns `void` or a disposable. Every event subscription,
command registration, overlay, and tool registration MUST be disposed when the
extension host is torn down.

The default renderer boundary remains:

```ts
mount(root: ShadowRoot, context: RendererContext): {
  update(next: RendererContext): void | Promise<void>;
  dispose(): void | Promise<void>;
}
```

The renderer context grows additively. Existing v0.2 renderers remain valid.
Host API `1.1.0` adds a renderer-lifetime abort signal, host-owned activity and
reduced-motion state, and one shared activity-gated frame scheduler. Existing
extensions declaring `^1.0.0` remain compatible; extensions using these fields
declare `^1.1.0`. Frames are browser-local and cannot create document
mutations, revisions, history, persistence, or network operations.

## Framework policy

The core extension SDK is framework-neutral. Optional React helpers MAY render
inside the supplied ShadowRoot but cannot be required by the host.

Theme support expands from four tokens to a documented semantic token set.
Extensions SHOULD use host tokens and standard controls for inspectors,
diagnostics, loading, and empty states.

## Development host

`agentcanvas extension dev` starts a disposable development installation with:

- one target extension mounted from its build output;
- source maps and browser diagnostics;
- fixture canvas data;
- restart-on-server-build and browser module reload;
- no mutation of the operator's production `plugins/` directory or database.

This is separate from production activation and does not change the rule that
installed production extensions require a host restart.

## Verification and packaging

`agentcanvas extension verify` MUST validate:

- descriptor and generated manifest agreement;
- declared and registered contributions;
- browser lifecycle cleanup;
- JSON schemas and migrations;
- contained distribution paths;
- license and required documentation;
- absence of forbidden private AgentCanvas imports.

`agentcanvas extension pack` produces a deterministic installable directory or
archive. The runtime never installs packages from the network.
