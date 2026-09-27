# HTTP and MCP

AgentCanvas exposes one registry-derived contract through HTTP, runtime OpenAPI, resident MCP, and the stdio MCP bridge.

## Contract discovery

- `GET /openapi.json`: authoritative HTTP contract for the exact active plugin set.
- `GET /api/v1/plugins`: sanitized active-plugin and capability status.
- `GET /api/v1/plugins/{pluginId}`: one plugin's contributions and browser entry URL.
- MCP `/mcp` `tools/list`: core tools, common bundled tools, and generic extension dispatch.
- MCP `/mcp/full` `tools/list`: every active named extension tool using the same registry-owned JSON Schemas.
- `docs/openapi.standard.json`: generated three-default-extension reference, not a substitute for runtime discovery.
- `docs/mcp-tools.standard.json`: normalized generated MCP catalog for the same distribution.
- `docs/error-codes.json`: generated registry of stable application error codes.

The owning schemas live in the frozen registry. Plugins register JSON Schema 2020-12 for elements, tools, and procedures; the host must not maintain a parallel handwritten schema.

## Diagnostics configuration

Use the canvas index's **Diagnostics** control or `PATCH /api/v1/configuration`:

```json
{
  "diagnostics": {
    "overlapMode": "bounded",
    "maxOverlapWarnings": 100
  }
}
```

`overlapMode` is `off`, `bounded`, or `all`. The integer `maxOverlapWarnings` is
required (1–10,000) and used only in bounded mode. Off skips overlap inspection;
all emits every detected pair. Bounded stops after detecting one overlap beyond
the limit and adds `overlap_diagnostics_truncated` with severity `info`. It does
not count the unexamined pairs. Inspection summaries count returned diagnostics,
not all possible warnings. All mode retains the quadratic scan and potentially
large response cost by explicit choice. Missing-extension, extension-owned,
resource, and snapshot diagnostics remain enabled, as does write validation.

Configuration PATCH changes only supplied settings; `defaultCanvasSize` remains
accepted independently, and updating either setting preserves the other. GET and
PATCH return `{ "ok": true, "configuration": { ... } }` including diagnostics,
defaultCanvasSize, source, and updatedAt. Malformed settings return 400
`validation_error` without changing persisted configuration. Existing settings
rows without diagnostics use bounded/100; no database migration is required.

Settings apply installation-wide on subsequent HTTP, MCP inspection/mutation,
share, embed, and snapshot reads. They neither modify canvases nor advance
revisions. Browser polling refreshes diagnostics even at an unchanged revision;
API clients should refresh configuration and affected projections after saving.
Configuration continues to use the existing HTTP surface; no MCP tools are added.

## Macro input semantics

Macro references are evaluated in saved template payloads. Values read from invocation input are inserted as literal JSON. This applies to HTTP and MCP planning, including input values shaped like `$macroRef` expressions. Callers that previously placed reference expressions inside invocation input must move those expressions into the saved template. Planning remains read-only; execution retains revision checks and idempotent replay. See [macro guidance](proposals/macros.md).

## Application failures

HTTP application failures use `application/problem+json`. Every body includes `type`, stable `title`, HTTP `status`, occurrence-specific `detail`, stable lowercase `code`, `category`, `retryable`, and `requestId`; `instance`, validation `issues`, and `remediation` may also be present. Clients must branch on `code`, not on `title` or `detail`.

```json
{
  "type": "urn:workspace2:problem:not_found",
  "title": "Resource not found",
  "status": 404,
  "detail": "canvas not found: canvas_123",
  "code": "not_found",
  "category": "not_found",
  "retryable": false,
  "requestId": "req_123",
  "instance": "/api/v1/canvases/canvas_123"
}
```

The pre-alpha.2 flat `{ok:false, code, message, stage, retryable, correlationId}` HTTP envelope is removed with no fallback. MCP transport and JSON-RPC errors remain protocol-native. Once a tool is dispatched, an application failure sets `isError: true` and exposes the same Problem Details object at `structuredContent.problem`.

## HTTP route groups

| Area | Routes |
|---|---|
| Health and identity | `GET /health`, `GET /whoami` |
| Canvas documents | `GET/POST /api/v1/canvases`, `GET/PATCH /api/v1/canvases/{canvasId}`, `PATCH .../title`, `PATCH .../theme` |
| Elements | `POST /api/v1/canvases/{canvasId}/elements:batch` |
| Viewports | `GET/POST .../viewport`, `POST .../viewport/focus`, `PUT/DELETE .../viewer-presence/{viewerId}` |
| Sharing | `GET/POST .../share-links`, `DELETE .../share-links/{shareLinkId}`, `GET /api/v1/share/{token}` |
| Embedding | `POST /api/v1/embed-sessions`, `GET/DELETE /api/v1/embed-sessions/{token}` |
| Snapshots | `POST /api/v1/canvases/{canvasId}/snapshot` |
| Plugins | `GET /api/v1/plugins`, plugin detail, browser modules, and plugin procedures |
| Macros | `GET/POST /api/v1/macros`, exact-version `GET /api/v1/macros/{macroId}/versions/{version}` (optional `canvasId`), `POST /api/v1/macros/{macroId}/versions`, `PATCH /api/v1/macros/{macroId}`, canvas-scoped plan, and `POST /api/v1/canvases/{canvasId}/macros:execute` |
| Resources | `GET /api/v1/resources/{handle}/details`, `GET .../content` |
| Host configuration | `GET/PATCH /api/v1/configuration` |

Human routes `/`, `/canvases`, `/canvases/{canvasId}`, `/c/{shareToken}`, and
`/embed/{token}` serve the browser application and remain unversioned. Only the
embed route is frameable, and only by the exact parent origin in its active
session. See [Embedding AgentCanvas](embedding.md).

Visible canvas tabs, including direct, shared, and embedded views, report their
current world-space center and zoom plus measured CSS-pixel width and height to
`PUT /api/v1/canvases/{canvasId}/viewer-presence/{viewerId}`. The browser uses a
random UUID for each visible session, refreshes it every 10 seconds, and attempts
`DELETE` when hidden or closed. Entries expire after 30 seconds without a report
and disappear on service restart. They are not saved canvas viewports, do not
change document revisions, and are not returned by any browser HTTP read. At
most 1,000 sessions may be active across the process.

## Canvas read projection

Canvas lists (`GET /api/v1/canvases` and MCP `canvas_list`) accept an optional integer
`limit` from 1 through 200, defaulting to 50 only when omitted. HTTP rejects empty,
malformed, fractional, nonfinite, or out-of-range values with `400` Problem Details
and `code: "validation_error"`; it does not clamp values.

MCP canvas responses use the canonical persisted element envelope, including elements
whose extension is no longer installed. Reads and supported kernel-owned mutations
preserve those elements; inspected responses include `plugin_unavailable` diagnostics.
Upsert inputs remain restricted to installed element types and current schemas.
With no element extensions installed, canvas creation and reads remain available,
but element upserts are rejected. Missing-extension data replacement is also rejected.

A canvas read separates durable and runtime state:

```json
{
  "ok": true,
  "canvas": {
    "id": "canvas_...",
    "revision": 3,
    "elements": []
  },
  "elementRuntime": {},
  "diagnostics": []
}
```

Only `canvas` is persisted. Resolved resource handles, provider responses, connector geometry, and resolution errors stay in `elementRuntime` or `diagnostics`.

## Explicit element operations

The batch endpoint accepts one or more operations:

- `upsertElement`
- `patchElementFrame`
- `replaceElementData`
- `replaceElementMetadata`
- `deleteElement`
- `clear`

Example current-version element write:

```json
{
  "expectedRevision": 1,
  "idempotencyKey": "place-card-001",
  "operations": [
    {
      "op": "upsertElement",
      "element": {
        "id": "card-1",
        "type": "acme.signal-card/card",
        "schemaVersion": 1,
        "x": 120,
        "y": 80,
        "width": 320,
        "height": 180,
        "data": {
          "title": "Build",
          "status": "healthy"
        }
      }
    }
  ]
}
```

The owning plugin must be active for upserts and data/style replacement. `id`, `type`, and `schemaVersion` are immutable during normal patch operations. Type changes use delete plus upsert; schema changes use registered migrations.

## Macro operations

Macros are host-owned declarative creation definitions. Create and version them
through the generic HTTP/MCP macro operations only; selection authoring and
extension planners are not v1 creation surfaces. Fetch definitions by exact
`macroId` and `macroVersion`, then plan with:

```text
POST /api/v1/canvases/{canvasId}/macros/{macroId}:plan

{
  "macroVersion": 1,
  "anchor": { "x": 40, "y": 60 },
  "input": { "rows": [] },
  "label": "Optional history label"
}
```

Planning validates typed input and dependencies, returns a short-lived plan,
preview elements, an effect summary, and named outputs, and does not mutate the
canvas or persist preview elements. Execute a plan with
`POST /api/v1/canvases/{canvasId}/macros:execute`, supplying `planId`,
`expectedRevision`, and `idempotencyKey` without duplicating `canvasId`. The
commit is atomic and creates one
canvas revision and one undo/redo history unit. Direct `canvas_run_macro` mode
performs the same internal planning and validation before committing; it does
not bypass those checks. Macro provenance retains exact-version and digest
metadata, not raw invocation inputs.

## Plugin procedures

Plugin procedures are exposed at:

```text
POST /api/v1/plugins/{pluginId}/procedures/{procedureName}
```

Input and output are validated against the plugin descriptor. Procedures run through host request security and a 30-second deadline. Binary output must be returned as an opaque resource handle.

## Resource handles

Snapshot and export responses return metadata such as:

```json
{
  "handle": "res_...",
  "url": "/api/v1/resources/res_.../content",
  "mimeType": "image/svg+xml",
  "byteLength": 12345,
  "width": 1200,
  "height": 800,
  "sha256": "..."
}
```

Do not persist handles or treat them as durable asset identity. They are controlled runtime references. Agent-facing JSON never contains full base64 or data URLs.

## MCP transports

The resident endpoint is:

```text
POST http://127.0.0.1:23003/mcp
```

The stdio command is a bridge to that resident endpoint:

```bash
npm run mcp --silent
```

It connects to `AGENT_CANVAS_BASE_URL` when that bridge-specific override is set; otherwise it uses the host's `AGENT_CANVAS_PUBLIC_BASE_URL`. It does not discover plugins, open SQLite, or construct a second registry. If the resident service is unavailable, stdio is unavailable.

### Refresh clients after a v0.2 upgrade

V0.2 removed the old feature aliases and derives plugin tool names from plugin IDs. After upgrading the host:

1. Restart AgentCanvas.
2. Restart the client's stdio bridge process or use the client's MCP reload/reconnect action.
3. Request a fresh `tools/list` and verify names against the active plugin catalog.
4. Replace stored prompts or automation that still call v0.1 aliases.

Do not trust a tool list cached before the restart. A stale client may display old names even though the v0.2 server correctly rejects them.

## Core MCP tools

The kernel registers:

- `canvas_get_guidance`
- `canvas_create`
- `canvas_list`
- `canvas_get`
- `canvas_list_viewers`
- `canvas_list_elements`
- `canvas_get_element`
- `canvas_get_url`
- `canvas_inspect`
- `canvas_rename`
- `canvas_set_theme`
- `canvas_clear_theme`
- `canvas_upsert_element`
- `canvas_patch_element_frame`
- `canvas_replace_element_data`
- `canvas_replace_element_metadata`
- `canvas_delete_element`
- `canvas_clear`
- `canvas_list_plugins`
- `canvas_get_plugin`
- `canvas_get_extension_tool`
- `canvas_read_extension_tool`
- `canvas_mutate_extension_tool`

Macro tools are generic and remain stable when definitions are saved or
versioned:

- `macro_list`
- `macro_get`
- `macro_create`
- `macro_create_version`
- `macro_archive`
- `macro_plan`
- `canvas_run_macro`

`/mcp` directly publishes filesystem-image, primitive, Markdown, and table tools.
Other active extension tools are discoverable with `canvas_list_plugins` and
`canvas_get_extension_tool`, then invoked through the read-only or mutating
dispatcher. Both dispatchers use the registry-owned descriptor, validation,
permissions, invocation context, and errors. `/mcp/full` additionally publishes
every named extension tool as `<normalized-plugin-id>__<normalized-local-name>`.
The stdio bridge uses `/mcp` unless `AGENT_CANVAS_MCP_PROFILE=full` is set.
`/whoami` reports both endpoints and the default profile.

`canvas_list_viewers({canvasId})` returns `{canvasId, asOf, viewers}`. Each
viewer has an opaque `viewerId`, a viewport, and `lastSeenAt`; the array is empty
when no visible tab has reported recently. IDs identify sessions, not people.
Viewport data is geometry only, and the list is available through MCP rather
than a browser HTTP read.

`canvas_create` returns the direct browser `url` for the new canvas. Use
`canvas_get_url` to recover that URL from a canvas ID later. Both URLs are
derived from `AGENT_CANVAS_PUBLIC_BASE_URL`; they are direct application routes,
not share links, and do not make a locally bound service reachable from another
machine. Use the existing share-link HTTP routes when a read-only token link is
the intended access model.

Every successful canvas MCP mutation returns a compact receipt with `canvasId`,
`revision`, and whole-canvas `inspectionSummary` counts. It does not repeat
elements, captions, document text, or individual diagnostics. If a count is
nonzero, call `canvas_inspect` for the diagnostic details. `canvas_get` remains
the explicit full persisted-document read. Browser-facing HTTP mutations continue
returning their full response projections.

Successful MCP results keep the complete value only in `structuredContent`.
Their text content is a bounded one-line receipt containing identifiers,
revisions, and collection counts; clients must not parse it as the full result.

MCP `canvas_list` returns summaries with element counts while HTTP canvas lists
remain full. Use revision-bound `canvas_list_elements` pagination for frames and
bounded extension summaries, `canvas_get_element` for one complete element, and
`canvas_get` only for an explicit full document. `canvas_inspect` supports
severity/code filters and revision-bound pages while always returning whole-canvas
diagnostic counts. `canvas_list_plugins` is compact; `canvas_get_plugin` returns
one full extension status.

Macro creation and version writes return `macroId`, `currentVersion`, and
`archived`. `canvas_run_macro` returns the canvas receipt plus provenance, named
outputs, and affected IDs; it omits the canvas document and operation history.
`macro_plan` returns only plan identity, revisions, digests, expiry, named
outputs, and its effect summary; HTTP planning retains operations and preview elements.

Use `canvas_inspect` as the deliberate final whole-canvas audit after composing
or resizing elements. It runs the same inspection owner used by mutation
responses; it does not replace a browser check for appearance or
remote-resource loading.
Plugins persist `allowScroll` or `allowClipping` intent when those options are
used, so later audits can distinguish a deliberate compact frame from an
accidental one.

## Concurrency and retry guidance

- Supply `expectedRevision` for mutations when coordinating against a read.
- Use an idempotency key for retried document batches.
- Check receipt counts after each mutation and call `canvas_inspect` when any are
  nonzero. Fetch `canvas_get` only when full persisted state is required.
- Retry only failures marked retryable.
- Do not retry validation, missing-plugin, unsupported-version, or revision-conflict failures without changing the request or refreshing state.

Every OpenAPI operation includes stable `operationId`, response schemas, `x-error-codes`, and formal `x-agent-notes` describing selection, side effects, and required refresh domains. Run `npm run check:contracts` after route, schema, error, example, or tool changes.
