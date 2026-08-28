# HTTP and MCP

AgentCanvas exposes one registry-derived contract through HTTP, runtime OpenAPI, resident MCP, and the stdio MCP bridge.

## Contract discovery

- `GET /openapi.json`: authoritative HTTP contract for the exact active plugin set.
- `GET /api/v1/plugins`: sanitized active-plugin and capability status.
- `GET /api/v1/plugins/{pluginId}`: one plugin's contributions and browser entry URL.
- MCP `tools/list`: core tools plus active plugin tools using the same JSON Schemas.
- `docs/openapi.standard.json`: generated three-default-extension reference, not a substitute for runtime discovery.
- `docs/mcp-tools.standard.json`: normalized generated MCP catalog for the same distribution.
- `docs/error-codes.json`: generated registry of stable application error codes.

The owning schemas live in the frozen registry. Plugins register JSON Schema 2020-12 for elements, tools, and procedures; the host must not maintain a parallel handwritten schema.

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
| Viewports | `GET/POST .../viewport`, `POST .../viewport/focus` |
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

## Canvas read projection

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

Macro tools are generic and remain stable when definitions are saved or
versioned:

- `macro_list`
- `macro_get`
- `macro_create`
- `macro_create_version`
- `macro_archive`
- `macro_plan`
- `canvas_run_macro`

Plugin tools use `<normalized-plugin-id>__<normalized-local-name>`. For example, `agentcanvas.image-overlays` plus `add-bbox` becomes `agentcanvas_image_overlays__add_bbox`.

Use `canvas_list_plugins` or HTTP plugin discovery before choosing a plugin tool. An optional tool is absent when its plugin folder is absent.

`canvas_create` returns the direct browser `url` for the new canvas. Use
`canvas_get_url` to recover that URL from a canvas ID later. Both URLs are
derived from `AGENT_CANVAS_PUBLIC_BASE_URL`; they are direct application routes,
not share links, and do not make a locally bound service reachable from another
machine. Use the existing share-link HTTP routes when a read-only token link is
the intended access model.

Every successful core MCP mutation returns the post-mutation canvas with
`diagnostics` and `inspectionSummary`. Read those fields before making the next
edit: they immediately expose plugin-owned checks such as likely content
clipping, along with intersecting non-connector frames. `canvas_get` returns the
same advisory inspection projection.

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
- Read the returned post-mutation diagnostics immediately, then refresh the
  canvas projection before final verification.
- Retry only failures marked retryable.
- Do not retry validation, missing-plugin, unsupported-version, or revision-conflict failures without changing the request or refreshing state.

Every OpenAPI operation includes stable `operationId`, response schemas, `x-error-codes`, and formal `x-agent-notes` describing selection, side effects, and required refresh domains. Run `npm run check:contracts` after route, schema, error, example, or tool changes.
