# AgentCanvas Plugin SDK

`@agentcanvas/plugin-sdk` is the public, framework-neutral contract for AgentCanvas plugins. It contains only
types and deterministic identifier/JSON helpers. It does not import the AgentCanvas server, React, Hono,
SQLite, or provider-specific code.

Plugins are trusted application dependencies. The permission declarations in a plugin manifest describe the
supported host API; they are not a security sandbox.

## Server entry

Export an object implementing `AgentCanvasServerPlugin` from the server entry declared in
`agentcanvas.plugin.json`. Register every contribution declared by the manifest during `activate(host)`.
Registration is synchronous even when `activate` performs asynchronous setup; the host validates and freezes
the complete registry before it starts serving requests.

## Browser entry

Export an object implementing `AgentCanvasBrowserPlugin`. Browser renderers use a ShadowRoot supplied by the
host and return `update` and `dispose` lifecycle methods. Plugins must bundle their browser dependencies and
must not import the host's React runtime.

## Persisted elements

The host owns the stable `CanvasElement` envelope. A plugin owns only the JSON data and optional style schemas
for its registered element types. Runtime provider results belong in the read projection, never in persisted
element data.

Provider-neutral image consumers use the host-owned `agentcanvas.image-sources@1.0.0` capability. Source extensions register strict provider adapters; consuming extensions persist `{ provider, reference }` envelopes and receive only opaque same-origin image resource handles.

## Canvas themes

`CanvasThemeV1` is the semantic canvas-wide design contract. Browser renderers receive it as
`RendererContext.theme`; snapshot renderers receive the same resolved value as `SnapshotRendererContext.theme`.
Use `themedString` and `themedNumber` so explicit element styles override theme tokens. Extensions should map
roles such as surface, text, border, accent, highlight, typography, and radius consistently rather than
maintaining separate browser and snapshot defaults.

## Documentation

- [Plugin authoring overview](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-authoring/README.md)
- [Build your first plugin](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-authoring/tutorial.md)
- [Plugin API reference](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-api-reference.md)
- [Manifest reference](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-manifest-reference.md)
- [Capabilities and permissions](https://github.com/jackspooner/AgentCanvas/blob/main/docs/plugin-capabilities-and-permissions.md)
