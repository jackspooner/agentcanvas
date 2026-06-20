# AgentCanvas

Local agent-operable web canvas for Workspace2. Agents can create canvases, place text/Markdown/assets/single-GLB 3D viewers/connectors/tables/path overlays, and return read-only browser links to the user.

## Boundaries

- HTTP service: `http://127.0.0.1:23003`
- Host binding: `127.0.0.1`
- Persistence: SQLite via Node `node:sqlite`
- MCP: dedicated `AgentCanvasMcp`
- Assets: `Assets-2` asset refs only
- Legacy `asset_registry`, `asset-registry`, and `asset-registry-2` paths are disabled/out of scope
- Canvas UI: white infinite-feeling surface centered around world coordinate `0,0`
- Viewport model: agents and users work in world coordinates; default visible browser assumption is `1920x900`

## Commands

```bash
cd C:/path/to/AgentCanvas
npm install
npm test
npm run build
npm run dev
```

Health checks:

```bash
curl http://127.0.0.1:23003/health
curl http://127.0.0.1:23003/whoami
curl http://127.0.0.1:23003/openapi.json
```

## Environment

Optional overrides:

```text
AGENT_CANVAS_HOST=127.0.0.1
AGENT_CANVAS_PORT=23003
AGENT_CANVAS_PUBLIC_BASE_URL=http://127.0.0.1:23003
AGENT_CANVAS_DB=C:/path/to/AgentCanvas/data/agent-canvas.sqlite
ASSETS_BASE_URL=http://127.0.0.1:23000
```

## MCP

Development command:

```bash
npm --prefix C:/path/to/AgentCanvas run mcp --silent
```

Direct command without npm shell output:

```bash
node C:/path/to/AgentCanvas/node_modules/tsx/dist/cli.mjs C:/path/to/AgentCanvas/src/mcp/index.ts
```

Example Hermes registration:

```bash
hermes mcp add agent-canvas \
  --command node \
  --args C:/path/to/AgentCanvas/node_modules/tsx/dist/cli.mjs C:/path/to/AgentCanvas/src/mcp/index.ts
```

Then verify:

```bash
hermes mcp test agent-canvas
```

## MCP tools

- `canvas_create`
- `canvas_list`
- `canvas_get`
- `canvas_get_link`
- `canvas_add_text`
- `canvas_add_markdown`
- `canvas_place_asset`
- `canvas_place_glb_viewer`
- `canvas_add_bbox_overlay`
- `canvas_add_bbox_overlay_from_asset`
- `canvas_add_path_overlay`
- `canvas_add_line`
- `canvas_add_arrow`
- `canvas_add_table`
- `canvas_update_element`
- `canvas_delete_element`
- `canvas_clear`
- `canvas_get_viewport`
- `canvas_set_viewport`
- `canvas_screenshot`

Tool outputs are compact JSON with IDs, revisions, links, element counts/summaries, and viewport state by default. `canvas_list` returns compact canvas metadata and element counts without full element payloads. `canvas_get` returns a compact canvas summary with capped element summaries; pass `mode: "full"` only when the complete canvas payload is required. Canvas mutation tools such as `canvas_place_asset`, `canvas_add_markdown`, `canvas_update_element`, and `canvas_delete_element` return compact mutation acknowledgements by default; pass `mode: "full"` only when a follow-up full-canvas read would be more expensive than returning the whole canvas once.

Large binaries/base64 are not returned through MCP by default. `canvas_screenshot` returns a retrievable screenshot URL and omits the inline SVG data URL unless `includeDataUrl: true` is explicitly passed.

## BBox layout assets

`bboxOverlay` nodes can now be owned by a durable `Assets-2` JSON asset instead of storing `canvasWidth`, `canvasHeight`, and `boxes` inline inside the canvas record. This is the preferred ownership model for reusable card/layout templates.

Asset-backed overlays use a JSON asset shaped like:

```json
{
  "schema": "bbox-layout/v1",
  "canvasWidth": 2932,
  "canvasHeight": 4096,
  "boxes": [
    { "id": "artwork", "x": 288, "y": 496, "width": 2352, "height": 1936, "label": "ARTWORK AREA" }
  ],
  "imageAssetRef": { "type": "asset", "project": "demo", "assetId": "..." },
  "caption": "63:88 bbox layout",
  "showLabels": true,
  "background": "#FAFAF9"
}
```

Use `canvas_add_bbox_overlay_from_asset` when the overlay should read from this asset, or `canvas_add_bbox_overlay` with `layoutAssetRef` when you want the general bbox overlay tool to resolve it the same way.

## Path overlay nodes

Agents can place render-only SVG path overlays with `canvas_add_path_overlay`. A path overlay stores a fixed internal coordinate space (`canvasWidth`/`canvasHeight`) plus one or more SVG `path.d` strings; the node view renders the shapes directly and shows a small legend for path labels when `showLabels` is not disabled.

Example element:

```json
{
  "id": "path_card_name",
  "type": "pathOverlay",
  "x": 40,
  "y": 980,
  "width": 630,
  "height": 880,
  "canvasWidth": 2932,
  "canvasHeight": 4096,
  "caption": "Card name path",
  "paths": [
    {
      "id": "name_panel",
      "d": "M 260 2700 Q 320 2520 520 2520 L 2412 2520 Q 2612 2520 2672 2700 Z",
      "label": "CARD NAME",
      "color": "#e11d48",
      "fill": "#e11d4822",
      "strokeWidth": 10
    }
  ]
}
```

## Asset placement

Canvas asset elements store durable `Assets-2` refs:

```json
{
  "type": "asset",
  "project": "demo",
  "assetId": "00000000-0000-4000-8000-000000000000",
  "assetBaseUrl": "http://127.0.0.1:23000"
}
```

The server resolves browser content URLs as:

```text
{assetBaseUrl}/projects/{project}/assets/{assetId}/content
```

Local paths such as `C:/...`, `/c/...`, `file://...`, and arbitrary URL strings are rejected as asset inputs.

## GLB viewer nodes

Agents can place small single-file GLB viewers with `canvas_place_glb_viewer`. The viewer stores only an Assets-2 GLB asset ref plus placement metadata; the browser receives the resolved asset content URL and renders it through `<model-viewer>`.

Example element:

```json
{
  "id": "glb_robot",
  "type": "glbViewer",
  "x": 100,
  "y": 120,
  "width": 320,
  "height": 240,
  "assetRef": {
    "type": "asset",
    "project": "demo",
    "assetId": "00000000-0000-4000-8000-000000000000"
  },
  "caption": "robot.glb",
  "cameraControls": true,
  "autoRotate": false
}
```

This is for opening one GLB per node. Multi-model scenes/worlds belong in AgentWorld/3D world tooling rather than in a flat canvas node.

## Share links

V1 share links are read-only bearer-token links:

```text
http://127.0.0.1:23003/c/<shareToken>
```

## Viewports

The browser canvas is an infinite-feeling white world surface. World coordinate `0,0` is centered in the viewport by default; element `x`/`y` positions are world coordinates.

The browser saves each canvas viewport in a per-canvas cookie and also posts the latest user viewport to the service:

```http
GET  /api/canvases/:canvasId/viewport
POST /api/canvases/:canvasId/viewport
POST /api/canvases/:canvasId/viewport/focus
```

Viewport state shape:

```json
{
  "centerX": 0,
  "centerY": 0,
  "zoom": 1,
  "width": 1920,
  "height": 900,
  "source": "user",
  "updatedAt": "..."
}
```

Agents should use `canvas_get_viewport` to see the last known user view and `canvas_set_viewport` to move the user's browser to a workflow area. Browser clients poll for agent viewport focus updates and apply them live.

`width` and `height` intentionally default to `1920x900`, matching the assumed browser window usable area.

## Markdown

Markdown elements are rendered with `react-markdown`, `remark-gfm`, and `rehype-sanitize`.

Allowed features include headings, lists, links, tables, inline code, and fenced code blocks. Raw HTML is skipped/sanitized; scripts, event handlers, iframes, and Markdown image tags are not rendered.
