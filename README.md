# AgentCanvas

Local agent-operable web canvas for Workspace2. Agents can create canvases, place text/Markdown/assets/single-GLB 3D viewers/connectors/tables, and return read-only browser links to the user.

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
- `canvas_add_line`
- `canvas_add_arrow`
- `canvas_add_table`
- `canvas_update_element`
- `canvas_delete_element`
- `canvas_clear`
- `canvas_get_viewport`
- `canvas_set_viewport`

Tool outputs are compact JSON with IDs, revisions, links, and viewport state. Large binaries/base64 are not returned through MCP.

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
