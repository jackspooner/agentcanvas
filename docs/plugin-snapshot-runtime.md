# AgentCanvas snapshot plugin runtime

## Scene contract

Snapshot renderers return:

```ts
interface SnapshotContribution {
  space: "frame" | "world";
  layer: "underlay" | "content" | "overlay";
  nodes: readonly SnapshotNode[];
  diagnostics?: readonly PluginDiagnostic[];
}
```

Supported nodes are `group`, `rect`, `ellipse`, `line`, `path`, `text`, and `imageHandle`. Nodes may use bounded opacity and affine transform matrices. Groups may clip with a rect or ellipse.

Plugins do not return raw SVG, HTML, CSS, external URLs, data URLs, or binary strings.

## Safety limits

Defaults are:

| Limit | Value |
|---|---:|
| Nodes | 10,000 |
| Nesting depth | 24 |
| Total text | 100,000 characters |
| Path data | 200,000 characters |
| Absolute coordinate | 1,000,000 |
| Image handles | 1,000 |
| Renderer deadline | 2 seconds per element |

Paint values reject `url(...)`, markup, quoting/control punctuation, and unsupported color syntax. Path syntax and every numeric token are validated. Image nodes accept opaque handle identifiers only.

## Composition

The compositor:

- collects all element contributions concurrently with per-renderer abort deadlines;
- converts missing, unsupported, failed, or non-hard-invalid contributions into diagnostic cards;
- aborts the whole snapshot only for hard aggregate safety limits;
- sorts by layer, element z-index, and document order;
- applies envelope translation, rotation, opacity, and frame clipping;
- includes world-space geometry in bounds;
- escapes all XML attributes and text;
- maps image handles to same-origin resource URLs;
- registers the final SVG bytes with the resource broker.

`POST /api/v1/canvases/:canvasId/snapshot` returns compact opaque handle metadata and diagnostics. It does not return an inline data URL.

Snapshot typography is deterministic semantic projection, not browser DOM pixel parity. Active WebGL content uses deterministic poster or placeholder policy.
