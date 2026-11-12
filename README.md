# AgentCanvas

AgentCanvas is a local-first visual workspace and MCP server for canvases built
by people and AI agents. Use the browser editor for visual planning, documents
and presentations, or let an agent edit the same canvas through MCP or HTTP.
Current version: **0.3.0-alpha.6**.

## Functionality

- **Canvas editor:** pan, zoom, selection, multi-move, resize, clipboard, grid
  snapping, undo/redo, fixed or unlimited bounds, and configurable overlap diagnostics.
- **Text and structured content:** text, shapes, connectors, sanitized
  [Markdown and card carousels](plugin-packages/markdown/README.md), and tables.
- **Images and media:** optional local-file and [Assets-2](https://github.com/jackspooner/assets2)
  sources, [image galleries](plugin-packages/gallery/README.md), overlays and mask
  exports, video playback, and GLB model viewing. See [media setup](docs/getting-started.md#choose-an-image-source).
- **Diagrams:** optional editable ERDs and Mermaid flowcharts, sequence, class,
  state, and ER diagrams, with visual controls and conversion. See [Diagrams](plugin-packages/diagrams/README.md).
- **Image-job bindings:** attach existing MediaTools image jobs to canvas or
  gallery slots and fill them when complete. See [MediaTools](plugin-packages/mediatools/README.md).
- **Durable canvases:** local SQLite persistence, revision checks,
  [themes](docs/canvas-themes.md), snapshots, and permanent canvas deletion.
- **Sharing and embedding:** read-only share links and scoped iframe sessions
  for host applications. See [Embedding](docs/embedding.md) and [HTTP and MCP](docs/http-and-mcp.md).
- **Agent automation:** registry-derived HTTP/MCP tools, inspection, live viewer
  viewports, and versioned creation [macros](docs/http-and-mcp.md#macro-operations).
- **Extensions:** SDK, testkit, scaffolder, browser commands, and snapshot
  renderers. See [Extension authoring](docs/plugin-authoring/README.md).

The default extensions provide primitives, Markdown, and tables. Media,
Diagrams, and MediaTools are optional. No media service is required.

## Get started

Requires **Node.js 24+, npm 11+, Git, and authenticated access to the pinned
private dependency repositories**, including Workspace2 API-contracts and
MediaTools packages. A public clone alone is insufficient to install this
version; your Git credentials must already have read access.

```bash
git clone https://github.com/jackspooner/agentcanvas.git
cd agentcanvas
npm run setup
npm run plugins:build
npm run plugins:materialize -- --defaults
npm run build
npm run dev
```

Open [localhost:23003](http://127.0.0.1:23003/). Follow
[Getting started](docs/getting-started.md) for configuration and media sources,
or [Upgrading](docs/upgrading.md) for an existing installation.

Check readiness at `http://127.0.0.1:23003/health`. Setup prepares only
checkout-local dependencies; it does not start services or databases. Existing
databases require an offline upgrade before startup; stop the service and retain
verified backups before migration or extension replacement. Missing optional
extensions preserve stored content and report diagnostics.

## Connect an agent or application

The resident MCP endpoint is `http://127.0.0.1:23003/mcp`; `/mcp/full` includes
all active named extension tools. `npm run mcp --silent` provides a stdio bridge
to the running service. HTTP document APIs use `/api/v1`; discover the installed
contract at `/openapi.json`. See the [HTTP/MCP guide](docs/http-and-mcp.md) for
transport configuration, requests and recovery.

AgentCanvas binds to loopback and has **no built-in authentication**. Keep it
local or use an authenticated, TLS-terminating reverse proxy. Extensions are trusted code, not
sandboxed. See [Security](SECURITY.md).

## Documentation

- [Documentation index](docs/README.md)
- [Deployment](docs/deployment.md), [operations](docs/operations.md), and [troubleshooting](docs/troubleshooting.md)
- [HTTP and MCP reference](docs/http-and-mcp.md) and [agent setup](docs/agent-readiness.md)
- [Architecture](docs/architecture.md), [data contracts](docs/data-contracts.md), and [extension runtime](docs/plugins.md)
- [Development and verification](CONTRIBUTING.md) and [change history](docs/changelog.md)

The source application is MIT-licensed; see [LICENSE](LICENSE). The root npm
package is private, and the SDK, testkit, and scaffolder are not yet published
to npm. Use the checkout-based authoring instructions above.
